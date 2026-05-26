export default function wandPlugin() {
  const serverUrl = process.env.VITE_WAND_SERVER_URL;

  return {
    name: '@nimrobo/wand-web',
    apply: 'serve',
    transformIndexHtml() {
      if (!serverUrl) return [];

      return [
        {
          tag: 'script',
          attrs: {
            src: `${serverUrl}/client.js`,
            'data-wand-client': 'true',
            'data-wand-server-url': serverUrl,
            async: true,
          },
          injectTo: 'head',
        },
      ];
    },
  };
}
