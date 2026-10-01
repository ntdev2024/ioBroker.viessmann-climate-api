import config, { esmConfig } from "@iobroker/eslint-config";

export default [
  {
    ignores: ["scripts/**", "tests/**", "test-results/**", "coverage/**"]
  },
  ...config,
  ...esmConfig,
  {
    rules: {
      "jsdoc/no-blank-blocks": "off",
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-param-description": "off",
      "prettier/prettier": [
        "error",
        {
          singleQuote: false,
          tabWidth: 2,
          trailingComma: "none",
          printWidth: 120,
          endOfLine: "lf"
        }
      ]
    }
  }
];
