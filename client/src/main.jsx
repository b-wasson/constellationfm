import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Cap the canvas backing resolution at 2x. force-graph sizes its canvases by
// window.devicePixelRatio with no way to override, so 3x phone screens pay
// for 2.25x more pixels per frame than a 2x laptop with no visible benefit
// on a graph of dots and lines. Capping it keeps performance comparable
// across devices and browsers.
const initialDpr = window.devicePixelRatio || 1;
const nativeDprGet = (
  Object.getOwnPropertyDescriptor(window, 'devicePixelRatio') ||
  Object.getOwnPropertyDescriptor(Window.prototype, 'devicePixelRatio')
)?.get;
try {
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    get: () => Math.min(nativeDprGet ? nativeDprGet.call(window) : initialDpr, 2),
  });
} catch {
  // leave the native value; just means extra pixels on 3x screens
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
