import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", ".aai/"] },
  tseslint.configs.recommended,
);
