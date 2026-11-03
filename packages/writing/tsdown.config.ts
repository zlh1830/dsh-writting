import { defineConfig } from 'tsdown'

const id = '@local/dsh-train-writing'
const EXTERNALS = ['react', 'react/jsx-runtime']

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  clean: false,
  external: EXTERNALS,
  noExternal: (source: string) => (EXTERNALS.includes(source) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  inputOptions: {
    resolve: {
      conditionNames: ['browser', 'import', 'require', 'default'],
    },
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: "${id}", factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
    codeSplitting: false,
  },
})
