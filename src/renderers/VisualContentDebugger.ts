export class VisualContentDebugger {
  static debugVisualData(visualData: any[], viewport: any) {
    console.log('🔍 VISUAL DEBUG - Data being sent to GPU:');
    
    visualData.forEach((visual, i) => {
      console.log(`Visual ${i}:`, {
        texCoords: visual.texCoords,
        color: visual.color,
        position: visual.position,
        size: visual.size,
        // Check for obvious issues
        issues: {
          invalidTexCoords: visual.texCoords.some((coord: number) => coord < 0 || coord > 1),
          zeroSize: visual.size[0] === 0 || visual.size[1] === 0,
          invalidColor: visual.color.some((c: number) => c < 0 || c > 1),
          offScreen: this.isOffScreen(visual.position, visual.size, viewport)
        }
      });
    });
  }

  static isOffScreen(position: number[], size: number[], viewport: any) {
    const worldBounds = {
      left: viewport.x - viewport.width / (2 * viewport.zoom),
      right: viewport.x + viewport.width / (2 * viewport.zoom), 
      top: viewport.y - viewport.height / (2 * viewport.zoom),
      bottom: viewport.y + viewport.height / (2 * viewport.zoom)
    };
    
    const visualBounds = {
      left: position[0] - size[0]/2,
      right: position[0] + size[0]/2,
      top: position[1] - size[1]/2,
      bottom: position[1] + size[1]/2
    };
    
    return visualBounds.right < worldBounds.left || 
           visualBounds.left > worldBounds.right ||
           visualBounds.bottom < worldBounds.top ||
           visualBounds.top > worldBounds.bottom;
  }

  static debugAtlas(atlas: any) {
    console.log('🔍 ATLAS DEBUG:');
    console.log('Atlas size:', atlas.getAtlasSize());
    console.log('Atlas stats:', atlas.getStats());
    console.log('Atlas entries:', atlas.getEntries());
    
    // Try to examine the canvas
    const canvas = atlas.getDebugCanvas();
    console.log('Canvas size:', canvas.width, 'x', canvas.height);
    
    // Check if canvas has any content
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, 100, 100);
    const hasContent = Array.from(imageData.data).some(pixel => pixel !== 0);
    console.log('Canvas has visible content:', hasContent);
    
    // Add canvas to DOM for inspection
    if (!document.getElementById('debug-visual-atlas')) {
      canvas.id = 'debug-visual-atlas';
      canvas.style.position = 'fixed';
      canvas.style.top = '10px';
      canvas.style.right = '10px';
      canvas.style.width = '200px';
      canvas.style.height = '200px';
      canvas.style.border = '2px solid red';
      canvas.style.zIndex = '10000';
      canvas.style.backgroundColor = 'white';
      document.body.appendChild(canvas);
    }
  }

  static debugShaderInputs(flatData: Float32Array, count: number) {
    console.log('🔍 SHADER INPUT DEBUG:');
    console.log('Buffer size:', flatData.length);
    console.log('Expected count:', count);
    console.log('Floats per visual:', flatData.length / count);
    
    // Print first visual's data
    if (flatData.length >= 12) {
      console.log('First visual data:', {
        texCoords: [flatData[0], flatData[1], flatData[2], flatData[3]],
        color: [flatData[4], flatData[5], flatData[6], flatData[7]],
        position: [flatData[8], flatData[9]],
        size: [flatData[10], flatData[11]]
      });
    }
  }
}

