// Copyright 2025 the AAI authors. MIT license.
// deno-lint-ignore-file react-no-danger
import { escape } from "@std/html";
import { renderToString } from "preact-render-to-string";

export const FAVICON_SVG: string =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#2196F3"/><path d="M50 25c-6 0-11 5-11 11v14c0 6 5 11 11 11s11-5 11-11V36c0-6-5-11-11-11z" fill="white"/><path d="M71 50c0 11-9 21-21 21s-21-10-21-21h-6c0 14 10 25 24 27v8h6v-8c14-2 24-13 24-27h-6z" fill="white"/></svg>`;

const COPY_SCRIPT = `function copyCmd(btn){
  const text=btn.parentElement.querySelector('code').textContent;
  navigator.clipboard.writeText(text).then(()=>{
    btn.textContent='Copied!';btn.classList.add('text-green-400','border-green-400');
    setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('text-green-400','border-green-400')},1500);
  });
}`;

const COPY_BUTTON_HTML =
  `<button class="absolute top-1/2 right-4 -translate-y-1/2 bg-transparent border border-gray-700 rounded px-2.5 py-1.5 text-sm font-mono text-gray-500 cursor-pointer transition-colors hover:text-gray-200 hover:border-gray-500" onclick="copyCmd(this)">Copy</button>`;

function CommandBlock({ children }: { children: string }) {
  return (
    <div
      class="relative bg-[#161616] border border-[#262626] rounded-xl py-5 pr-16 pl-6 text-lg leading-relaxed mb-6"
      dangerouslySetInnerHTML={{
        __html: `<code class="font-mono whitespace-pre">${
          escape(children)
        }</code>${COPY_BUTTON_HTML}`,
      }}
    />
  );
}

function LandingPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>aai</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script src="https://cdn.tailwindcss.com" />
      </head>
      <body class="m-0 p-0 box-border font-sans bg-[#0a0a0a] text-gray-200 min-h-screen flex items-center justify-center">
        <div class="max-w-3xl p-12 w-full">
          <h1 class="text-7xl font-bold mb-4">aai</h1>
          <p class="text-gray-500 mb-8 leading-relaxed text-xl">
            Build and deploy a voice agent in 10 seconds.
          </p>
          <div class="text-base text-gray-500 uppercase tracking-wide mb-3">
            Install
          </div>
          <CommandBlock>
            curl -fsSL https://aai-agent.fly.dev/install | sh
          </CommandBlock>
          <div class="text-base text-gray-500 uppercase tracking-wide mb-3">
            Run
          </div>
          <CommandBlock>aai</CommandBlock>
          <p class="mt-8">
            <a
              class="text-blue-400 no-underline text-lg hover:underline"
              href="https://github.com/alexkroman/aai"
            >
              GitHub
            </a>
          </p>
        </div>

        <script dangerouslySetInnerHTML={{ __html: COPY_SCRIPT }} />
      </body>
    </html>
  );
}

export function renderLandingPage(): string {
  return "<!DOCTYPE html>" + renderToString(<LandingPage />);
}

function AgentPage({ name, basePath }: { name: string; basePath: string }) {
  const initScript = `window.__AAI_BASE__="${
    escape(basePath)
  }";window.__AAI_WS__="${escape(basePath)}/websocket";`;

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <title>{name}</title>
        <meta name="description" content={`${name} — AI voice agent`} />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script src="https://cdn.tailwindcss.com" />
      </head>
      <body>
        <main id="app" />

        <script dangerouslySetInnerHTML={{ __html: initScript }} />
        <script type="module" src={`${escape(basePath)}/client.js`} />
      </body>
    </html>
  );
}

export function renderAgentPage(name: string, basePath = ""): string {
  return "<!DOCTYPE html>" +
    renderToString(<AgentPage name={name} basePath={basePath} />);
}
