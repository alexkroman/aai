export default function Layout() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <title>aai</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script src="https://cdn.tailwindcss.com" />
      </head>
      <body>
        <main id="app" />
        <script type="module" src="client.js" />
      </body>
    </html>
  );
}
