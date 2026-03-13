import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", ".aai/"] },
  tseslint.configs.recommended,
  {
    files: ["**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
      }],
    },
  },
);
