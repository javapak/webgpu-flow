// Mobile utilities for better touch handling and responsive design

export class MobileUtils {
  // Detect if we're on a mobile device
  static isMobileDevice(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) || window.innerWidth <= 768;
  }

  // Detect if touch is supported
  static isTouchDevice(): boolean {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  // Get optimal handle size for the current device
  static getOptimalHandleSize(zoom: number): number {
    const baseSize = this.isMobileDevice() ? 44 : 12; // 44px is Apple's recommended minimum touch target
    return Math.max(baseSize / zoom, this.isMobileDevice() ? 24 : 8);
  }

  // Get optimal grid size for current viewport
  static getOptimalGridSize(zoom: number): number {
    const baseGrid = 50;
    const scaledGrid = baseGrid / zoom;
    
    // On mobile, use larger grid spacing when zoomed out
    if (this.isMobileDevice() && zoom < 0.5) {
      return scaledGrid * 2;
    }
    
    return scaledGrid;
  }

  // Debounce function for touch events
  static debounce<T extends (...args: any[]) => void>(
    func: T,
    wait: number
  ): (...args: Parameters<T>) => void {
    let timeout: number;
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  // Throttle function for high-frequency events
  static throttle<T extends (...args: any[]) => void>(
    func: T,
    limit: number
  ): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    return (...args: Parameters<T>) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // Calculate distance between two points
  static distance(p1: {x: number, y: number}, p2: {x: number, y: number}): number {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }

  // Check if a gesture is a tap (vs drag)
  static isTap(startPos: {x: number, y: number}, endPos: {x: number, y: number}, duration: number): boolean {
    const maxTapDistance = this.isMobileDevice() ? 15 : 10;
    const maxTapDuration = 300;
    
    return this.distance(startPos, endPos) < maxTapDistance && duration < maxTapDuration;
  }

  // Get viewport meta tag settings for mobile
  static setupMobileViewport(): void {
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.setAttribute('name', 'viewport');
      document.head.appendChild(viewport);
    }
    
    // Prevent zooming on mobile while allowing programmatic zoom
    viewport.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'
    );
  }

  // Prevent default touch behaviors that interfere with canvas interaction
  static preventDefaultTouchBehaviors(): void {
    // Prevent pull-to-refresh
    document.body.style.overscrollBehavior = 'contain';
    
    // Prevent context menu on long press
    document.addEventListener('contextmenu', (e) => {
      if (this.isTouchDevice()) {
        e.preventDefault();
      }
    }, { passive: false });

    // Prevent double-tap zoom
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    }, { passive: false });
  }

  // Enhanced touch event listener that handles both mouse and touch
  static addUniversalEventListener(
    element: HTMLElement,
    type: 'start' | 'move' | 'end',
    handler: (e: MouseEvent | TouchEvent) => void,
    options?: AddEventListenerOptions
  ): () => void {
    const eventMap = {
      start: this.isTouchDevice() ? 'touchstart' : 'mousedown',
      move: this.isTouchDevice() ? 'touchmove' : 'mousemove', 
      end: this.isTouchDevice() ? 'touchend' : 'mouseup'
    };

    const eventName = eventMap[type];
    element.addEventListener(eventName, handler as EventListener, options);
    
    // Return cleanup function
    return () => {
      element.removeEventListener(eventName, handler as EventListener, options);
    };
  }

  // Get touch/mouse position in a unified way
  static getEventPosition(e: MouseEvent | TouchEvent): {x: number, y: number} {
    if ('touches' in e && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if ('changedTouches' in e && e.changedTouches.length > 0) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    } else {
      return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
    }
  }

  // Haptic feedback for mobile devices
  static vibrate(pattern?: number | number[]): void {
    if (navigator.vibrate && this.isMobileDevice()) {
      navigator.vibrate(pattern || 50);
    }
  }

  // Get safe area insets for modern mobile devices
  static getSafeAreaInsets(): {top: number, right: number, bottom: number, left: number} {
    const computedStyle = getComputedStyle(document.documentElement);
    
    return {
      top: parseInt(computedStyle.getPropertyValue('--safe-area-inset-top') || '0'),
      right: parseInt(computedStyle.getPropertyValue('--safe-area-inset-right') || '0'),
      bottom: parseInt(computedStyle.getPropertyValue('--safe-area-inset-bottom') || '0'),
      left: parseInt(computedStyle.getPropertyValue('--safe-area-inset-left') || '0')
    };
  }

  // Adjust canvas size for high DPI displays
  static setupHighDPICanvas(canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Set the canvas size in memory
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    // Scale the canvas back down using CSS
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    
    // Scale the drawing context so everything draws at the correct size
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }

  // Performance optimization: Check if an element is in viewport
  static isElementInViewport(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  // Mobile-optimized zoom constraints
  static getMobileZoomConstraints(): {min: number, max: number} {
    if (this.isMobileDevice()) {
      return { min: 0.2, max: 3.0 }; // More restrictive on mobile
    } else {
      return { min: 0.1, max: 5.0 }; // Desktop can handle more extreme zooms
    }
  }

  // Get optimal canvas dimensions for current device
  static getOptimalCanvasSize(): {width: number, height: number} {
    const safeArea = this.getSafeAreaInsets();
    const availableWidth = window.innerWidth - safeArea.left - safeArea.right;
    const availableHeight = window.innerHeight - safeArea.top - safeArea.bottom;
    
    if (this.isMobileDevice()) {
      // On mobile, leave some space for UI elements
      return {
        width: Math.max(300, availableWidth - 40),
        height: Math.max(400, availableHeight - 100)
      };
    } else {
      // Desktop can use more space
      return {
        width: Math.max(800, availableWidth * 0.8),
        height: Math.max(600, availableHeight * 0.8)
      };
    }
  }
}