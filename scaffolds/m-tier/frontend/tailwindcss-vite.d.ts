declare module "@tailwindcss/vite" {
  import type { PluginOption } from "vite";

  type TailwindVitePlugin = () => PluginOption;
  const tailwindcss: TailwindVitePlugin;
  export default tailwindcss;
}
