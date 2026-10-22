/** Server address comes from config (VITE_SERVER_URL), falling back to port 8080 on the page's own host. */
export const serverUrl: string =
  import.meta.env.VITE_SERVER_URL || `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8080`;
