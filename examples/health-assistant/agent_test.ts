import { expect } from "@std/expect";
import { stubFetchError, stubFetchJson, testCtx } from "@aai/server/testing";
import agent from "./agent.ts";

Deno.test("health-assistant - drug_info returns information", async () => {
  const result = (await agent.tools.drug_info.handler(
    { name: "ibuprofen" },
    testCtx(stubFetchJson({
      results: [
        {
          openfda: {
            generic_name: ["ibuprofen"],
            brand_name: ["Advil", "Motrin"],
            manufacturer_name: ["Pfizer"],
          },
          purpose: ["Pain reliever/fever reducer"],
          warnings: ["Stomach bleeding warning text"],
          dosage_and_administration: ["Adults: 200-400mg every 4-6 hours"],
          adverse_reactions: ["Nausea, stomach pain"],
        },
      ],
    })),
  )) as Record<string, unknown>;

  expect(result.name).toBe("ibuprofen");
  expect(result.brand_names).toEqual(["Advil", "Motrin"]);
  expect(result.manufacturer).toBe("Pfizer");
  expect(result.purpose).toBe("Pain reliever/fever reducer");
});

Deno.test("health-assistant - drug_info error on API failure", async () => {
  const result = (await agent.tools.drug_info.handler(
    { name: "nonexistentdrug" },
    testCtx(stubFetchError(404, "Not Found")),
  )) as Record<string, unknown>;
  expect(result.error as string).toContain("not found");
});

Deno.test("health-assistant - drug_info error on empty results", async () => {
  const result = (await agent.tools.drug_info.handler(
    { name: "unknowndrug" },
    testCtx(stubFetchJson({ results: [] })),
  )) as Record<string, unknown>;
  expect(result.error as string).toContain("No FDA data found");
});

Deno.test("health-assistant - drug_info handles missing openfda", async () => {
  const result = (await agent.tools.drug_info.handler(
    { name: "aspirin" },
    testCtx(stubFetchJson({
      results: [{ indications_and_usage: ["For headaches"] }],
    })),
  )) as Record<string, unknown>;
  expect(result.name).toBe("aspirin");
  expect(result.purpose).toBe("For headaches");
  expect(result.manufacturer).toBe("N/A");
});

Deno.test("health-assistant - check_interaction between two drugs", async () => {
  const fetch = ((input: string | URL) => {
    const url = String(input);
    if (url.includes("rxcui.json")) {
      const name = url.includes("ibuprofen") ? "ibuprofen" : "warfarin";
      const rxcui = name === "ibuprofen" ? "5640" : "11289";
      return Promise.resolve(
        Response.json({ idGroup: { rxnormId: [rxcui] } }),
      );
    }
    return Promise.resolve(
      Response.json({
        fullInteractionTypeGroup: [
          {
            fullInteractionType: [
              {
                interactionPair: [
                  {
                    description: "Increased bleeding risk",
                    severity: "high",
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
  }) as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "ibuprofen, warfarin" },
    testCtx(fetch),
  )) as Record<string, unknown>;

  expect(result.interactions_found).toBe(1);
  const interactions = result.interactions as Record<string, unknown>[];
  expect(interactions[0].description).toBe("Increased bleeding risk");
});

Deno.test("health-assistant - check_interaction error unresolved drugs", async () => {
  const result = (await agent.tools.check_interaction.handler(
    { drugs: "fakemed1, fakemed2" },
    testCtx(stubFetchError(404, "Not Found")),
  )) as Record<string, unknown>;
  expect(result.error as string).toContain("Could not resolve");
});

Deno.test("health-assistant - check_interaction error one drug resolves", async () => {
  let callCount = 0;
  const fetch = (() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(
        Response.json({ idGroup: { rxnormId: ["5640"] } }),
      );
    }
    return Promise.resolve(Response.json({ idGroup: {} }));
  }) as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "ibuprofen, unknowndrug" },
    testCtx(fetch),
  )) as Record<string, unknown>;
  expect(result.error as string).toContain("Could not resolve");
});

Deno.test("health-assistant - check_interaction no interactions found", async () => {
  let callCount = 0;
  const fetch = (() => {
    callCount++;
    if (callCount <= 2) {
      const rxcui = callCount === 1 ? "123" : "456";
      return Promise.resolve(
        Response.json({ idGroup: { rxnormId: [rxcui] } }),
      );
    }
    return Promise.resolve(Response.json({}));
  }) as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "drug1, drug2" },
    testCtx(fetch),
  )) as Record<string, unknown>;
  expect(result.interactions_found).toBe(0);
});

Deno.test("health-assistant - check_interaction lookup fails", async () => {
  let callCount = 0;
  const fetch = (() => {
    callCount++;
    if (callCount <= 2) {
      const rxcui = callCount === 1 ? "123" : "456";
      return Promise.resolve(
        Response.json({ idGroup: { rxnormId: [rxcui] } }),
      );
    }
    return Promise.resolve(new Response("Server Error", { status: 500 }));
  }) as typeof globalThis.fetch;

  const result = (await agent.tools.check_interaction.handler(
    { drugs: "drug1, drug2" },
    testCtx(fetch),
  )) as Record<string, unknown>;
  expect(result.error).toBe("Interaction lookup failed");
});
