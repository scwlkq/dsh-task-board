import { defineConfig } from "vitest/config"
import ts from "typescript"

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

function standardDecoratorPlugin() {
  return {
    name: "dsh-standard-decorators",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const file = id.split("?", 1)[0]
      if (file === undefined || !/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return

      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          ...(file.endsWith("x") ? { jsx: ts.JsxEmit.ReactJSX } : {}),
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, "\n"),
        map: result.sourceMapText,
      }
    },
  }
}

export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  test: {
    environment: "node",
  },
})
