import { defineConfig } from 'vite';
import { makeViteConfig } from '@bookplus/config/vite-preset.mjs';

export default defineConfig(makeViteConfig({ port: 3002 }));
