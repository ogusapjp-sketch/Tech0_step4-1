// Barcode Detection API（TypeScript の標準の型定義にまだ含まれないため）
interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}

interface BarcodeDetectorConstructor {
  new (options?: BarcodeDetectorOptions): {
    detect(source: CanvasImageSource | ImageBitmapSource): Promise<DetectedBarcode[]>;
  };
  getSupportedFormats(): Promise<string[]>;
}

interface Window {
  BarcodeDetector?: BarcodeDetectorConstructor;
}
