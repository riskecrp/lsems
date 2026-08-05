module.exports = {
  apps: [
    {
      name: "lsems-dashboard",
      script: "./start.sh",
      interpreter: "/bin/bash",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 3002,
        HOSTNAME: "0.0.0.0",
      },
      error_file: "./logs/error.log",
      out_file:   "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      listen_timeout: 5000,
      kill_timeout:   10000,
    },
  ],
};
