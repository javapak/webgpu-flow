import { WebGPURenderer } from './WebGPURenderer';

// Create one single instance that lives for the life of the browser tab
export const globalRenderer = new WebGPURenderer();
