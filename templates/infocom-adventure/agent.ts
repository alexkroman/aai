import { action, defineAgent, multiTool, z } from "@aai/sdk";
import type { ToolContext } from "@aai/sdk";

type GameState = {
  inventory: string[];
  currentRoom: string;
  score: number;
  moves: number;
  flags: Record<string, boolean>;
  history: string[];
};

function s(ctx: ToolContext): GameState {
  return ctx.state as GameState;
}

export default defineAgent({
  name: "Infocom Adventure",
  voice: "orion",
  greeting:
    "Welcome to the great underground empire. You are standing in an open field west of a white house, with a boarded front door. There is a small mailbox here. What would you like to do?",

  state: (): GameState => ({
    inventory: [],
    currentRoom: "West of House",
    score: 0,
    moves: 0,
    flags: {},
    history: [],
  }),

  instructions:
    `You are a classic Infocom-style text adventure game engine, simulating ZORK I: The Great Underground Empire.

You ARE the game. You maintain the world state, describe rooms, handle puzzles, manage inventory, track score, and respond to player commands — all faithfully recreating the Zork experience.

GAME WORLD RULES:
- Follow the geography, puzzles, and items of Zork I as closely as you can recall
- The map includes: West of House, North of House, Behind House, South of House, Kitchen, Living Room, Attic, Cellar, the Great Underground Empire (Troll Room, Flood Control Dam, Loud Room, etc.), the maze, Hades, and more
- Key items: brass lantern, elvish sword, jeweled egg, gold coffin, platinum bar, jade figurine, sapphire bracelet, trunk of jewels, crystal trident, etc.
- Key encounters: troll, thief, cyclops, spirits, vampire bat
- Puzzles work as they do in Zork: the dam, the coal mine, the Egyptian room, the mirror rooms, Hades, the maze, etc.
- Score increases when the player collects treasures and places them in the trophy case in the living room
- The brass lantern has limited battery life underground

VOICE-FIRST RESPONSE RULES:
- Describe rooms vividly but concisely — two to four sentences max
- For movement, describe the new room immediately
- For failed actions, give brief, witty responses in the Infocom style ("There is a wall in the way." or "You can't eat that.")
- Read inventory as a spoken list
- Announce score changes
- Keep the classic dry humor of Infocom games
- Never use visual formatting — no bullets, no bold, no lists with dashes
- Use "First... Then... Finally..." for sequences
- Use directional words naturally: "To the north you see..." not "N: forest"

COMMAND INTERPRETATION:
- Players speak naturally. Translate their voice into classic adventure commands
- "go north" / "head north" / "walk north" = north
- "pick up the sword" / "grab the sword" / "take sword" = take sword
- "what do I have" / "check my stuff" / "inventory" = inventory
- "where am I" / "look around" / "describe the room" = look
- "hit the troll" / "fight the troll" / "attack troll" = attack troll with sword
- "what's my score" = score
- Accept natural conversational commands and map them to game actions

Use the game_state tool to track inventory, location, score, and flags. Always update state when the player takes an item, moves rooms, or triggers an event. Check state before responding to ensure consistency.

ATMOSPHERE:
- Underground areas should feel dark and foreboding when the lantern is present, and terrifying in pitch blackness
- The thief should appear randomly and steal items
- The troll blocks the passage until defeated
- Convey a sense of mystery and danger
- Keep the wry, understated humor that made Infocom games legendary`,

  tools: {
    game_state: multiTool({
      description:
        "Read or update the current game state including inventory, room, score, and flags. Use action 'get' to read state, 'move' to change room, 'take' to add item to inventory, 'drop' to remove item, 'score' to add points, 'flag' to set a game flag, 'history' to log a command.",
      actions: {
        get: {
          execute: (_args: Record<string, unknown>, ctx: ToolContext) => {
            const g = s(ctx);
            return {
              currentRoom: g.currentRoom,
              inventory: g.inventory,
              score: g.score,
              moves: g.moves,
              flags: g.flags,
              recentHistory: g.history.slice(-5),
            };
          },
        },
        move: action({
          schema: z.object({
            value: z.string().describe("Room name to move to"),
          }),
          execute: ({ value }, ctx) => {
            const g = s(ctx);
            g.currentRoom = value;
            g.moves++;
            return { currentRoom: g.currentRoom, moves: g.moves };
          },
        }),
        take: action({
          schema: z.object({
            value: z.string().describe("Item name to take"),
          }),
          execute: ({ value }, ctx) => {
            const g = s(ctx);
            if (!g.inventory.includes(value)) g.inventory.push(value);
            return { inventory: g.inventory };
          },
        }),
        drop: action({
          schema: z.object({
            value: z.string().describe("Item name to drop"),
          }),
          execute: ({ value }, ctx) => {
            const g = s(ctx);
            g.inventory = g.inventory.filter((i) => i !== value);
            return { inventory: g.inventory };
          },
        }),
        score: action({
          schema: z.object({
            value: z.string().describe("Points to add"),
          }),
          execute: ({ value }, ctx) => {
            const g = s(ctx);
            g.score += parseInt(value) || 0;
            return { score: g.score };
          },
        }),
        flag: action({
          schema: z.object({
            value: z.string().describe("Flag name to set"),
          }),
          execute: ({ value }, ctx) => {
            const g = s(ctx);
            g.flags[value] = true;
            return { flags: g.flags };
          },
        }),
        history: action({
          schema: z.object({
            value: z.string().describe("Command text to log"),
          }),
          execute: ({ value }, ctx) => {
            const g = s(ctx);
            g.history.push(value);
            g.moves++;
            return { moves: g.moves, recentHistory: g.history.slice(-5) };
          },
        }),
      },
    }),
  },
});
