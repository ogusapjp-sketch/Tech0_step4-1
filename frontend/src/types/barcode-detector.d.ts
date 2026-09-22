// Barcode Detection API（TypeScript の標準の型定義にまだ含まれないため）
interface DetectedBarcode {
  rawValue: string;
  format: string;
  // 映像内の位置。1フレームに複数写ったとき、中心に近いものを選ぶのに使う（design.md 6.4）
  boundingBox: DOMRectReadOnly;
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
