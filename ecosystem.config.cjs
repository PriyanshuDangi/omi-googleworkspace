module.exports = {
  apps: [
    {
      name: 'omi-googleworkspace',
      cwd: __dirname,
      script: 'dist/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        // Avoid inheriting ephemeral local proxy variables that break OAuth calls.
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        ALL_PROXY: '',
        http_proxy: '',
        https_proxy: '',
        all_proxy: '',
        NO_PROXY: 'localhost,127.0.0.1',
        // Use local dependency binary so global install is not required.
        GWS_BIN: '/root/code/omi-googleworkspace/node_modules/.bin/gws',
      },
    },
  ],
};
