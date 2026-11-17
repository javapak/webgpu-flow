import globalRenderer from './gpuInstance';
import type { WebGPUFailure } from '../components/WebGPUUnsupported';

/**
 * Starts the shared renderer that every DiagramCanvas draws with; call once,
 * before mounting DiagramProvider. Returns why it couldn't start, or null.
 */
export async function startRenderer(): Promise<WebGPUFailure | null> {
  if (!navigator.gpu) return 'no-api';
  try {
    if (!(await globalRenderer.initialize())) return 'no-device';
    await globalRenderer.initializeLabelRenderer();
    await globalRenderer.initializeFloatingEdgeRenderer();
    return null;
  } catch (error) {
    console.error('Renderer failed to start:', error);
    return 'no-device';
  }
}
