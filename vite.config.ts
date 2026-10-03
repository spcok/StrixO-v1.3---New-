import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite'; // NEW: Tailwind v4 Plugin

export default defineConfig({
  plugins: [
    tailwindcss(), // NEW: Initialize Tailwind v4
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react()
  ],
});