module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
  ],
  // Uniquement sous Jest unitaire (babel-jest, CommonJS) : `import.meta` n'existe pas en
  // CommonJS (« Cannot use 'import.meta' outside a module »). config/env.js — chargé par db.js,
  // donc par tout module testé qui touche la base — en a besoin pour localiser server/.env.
  // On le remplace par l'équivalent CommonJS : `{ url: <URL file:// du fichier courant> }`.
  // Le serveur réel et la suite d'intégration tournent en ESM natif et n'appliquent pas ce bloc.
  env: {
    test: {
      plugins: [
        function importMetaVersCommonJs({ template }) {
          const remplacement = template.expression.ast`({ url: require('url').pathToFileURL(__filename).href })`;
          return {
            name: 'import-meta-vers-commonjs',
            visitor: {
              MetaProperty(path) {
                const { meta, property } = path.node;
                if (meta && meta.name === 'import' && property && property.name === 'meta') {
                  path.replaceWith(remplacement);
                }
              },
            },
          };
        },
      ],
    },
  },
};
