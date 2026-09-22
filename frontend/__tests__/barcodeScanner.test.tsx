/** @jest-environment jsdom */
// カメラによるバーコード読み取り（design.md 2.2、requirements.md 5.3・7章④）
// Code128 を Barcode Detection API で読み、非対応なら ZXing に切り替える（人間が決定）。test_extra_
import { act, render, screen } from "@testing-library/react";

import { BarcodeScanner } from "@/components/BarcodeScanner";

const mockDecodeFromConstraints = jest.fn();
const mockReaderConstructor = jest.fn();
jest.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: function BrowserMultiFormatReader(hints: unknown) {
    mockReaderConstructor(hints);
    return { decodeFromConstraints: mockDecodeFromConstraints };
  },
}));
jest.mock("@zxing/library", () => ({ BarcodeFormat: { CODE_128: 4 }, DecodeHintType: { POSSIBLE_FORMATS: 2 } }));

const trackStop = jest.fn();
const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
const getUserMedia = jest.fn();

type DetectorMock = { detect: jest.Mock };
let detector: DetectorMock;

const installBarcodeDetector = (formats: string[]) => {
  detector = { detect: jest.fn().mockResolvedValue([]) };
  const ctor = jest.fn().mockImplementation(() => detector) as unknown as { getSupportedFormats: jest.Mock };
  ctor.getSupportedFormats = jest.fn().mockResolvedValue(formats);
  Object.defineProperty(window, "BarcodeDetector", { value: ctor, configurable: true, writable: true });
  return ctor;
};

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  getUserMedia.mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Barcode Detection API（第一候補）", () => {
  it("test_extra_ Code128 に対応していれば、背面カメラの映像から Code128 を読み取る", async () => {
    const ctor = installBarcodeDetector(["code_128", "qr_code"]);
    const onDetect = jest.fn();
    render(<BarcodeScanner onDetect={onDetect} now={() => 0} />);
    detector.detect.mockResolvedValueOnce([{ rawValue: "1001" }]);
    await flush();

    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false });
    expect(ctor).toHaveBeenCalledWith({ formats: ["code_128"] });
    expect(onDetect).toHaveBeenCalledWith("1001");
    expect(mockReaderConstructor).not.toHaveBeenCalled();
    expect(screen.getByText("スキャン中（BarcodeDetector）")).toBeInTheDocument();
  });

  it("test_extra_ かざしたままの間は、同じコードを繰り返し追加しない", async () => {
    installBarcodeDetector(["code_128"]);
    let now = 0;
    const onDetect = jest.fn();
    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    render(<BarcodeScanner onDetect={onDetect} now={() => now} />);
    await flush();
    expect(onDetect).toHaveBeenCalledTimes(1);

    // かざしたまま：映り続けている間は何周期たっても受け付けない（読み取りは 200ms ごと）
    for (const at of [200, 400, 600, 800, 1000, 1200]) {
      now = at;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(200);
      });
    }
    expect(onDetect).toHaveBeenCalledTimes(1);
  });

  it("test_extra_ 1.0秒以上・連続5フレーム読めなくなったら、同じコードをもう一度読み取れる", async () => {
    installBarcodeDetector(["code_128"]);
    let now = 0;
    const onDetect = jest.fn();
    const frame = async (codes: string[]) => {
      now += 200;
      detector.detect.mockResolvedValue(codes.map((rawValue) => ({ rawValue })));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(200);
      });
    };

    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    render(<BarcodeScanner onDetect={onDetect} now={() => now} />);
    await flush();
    expect(onDetect).toHaveBeenCalledTimes(1);

    // 読み取りが4フレーム途切れただけでは解除しない（手ぶれで一瞬外れた場合）
    for (let i = 0; i < 4; i += 1) {
      await frame([]);
    }
    await frame(["1001"]);
    expect(onDetect).toHaveBeenCalledTimes(1);

    // 5フレーム連続で読めず、最後の検出から 1.0秒以上たったら受け付ける
    for (let i = 0; i < 5; i += 1) {
      await frame([]);
    }
    await frame(["1001"]);
    expect(onDetect).toHaveBeenCalledTimes(2);
    expect(onDetect).toHaveBeenNthCalledWith(2, "1001");
  });

  it("test_extra_ 別のコードは、前のコードをかざしたままでもすぐ受け付ける", async () => {
    installBarcodeDetector(["code_128"]);
    let now = 0;
    const onDetect = jest.fn();
    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    render(<BarcodeScanner onDetect={onDetect} now={() => now} />);
    await flush();

    detector.detect.mockResolvedValue([{ rawValue: "2001" }]);
    now = 200;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(onDetect).toHaveBeenNthCalledWith(1, "1001");
    expect(onDetect).toHaveBeenNthCalledWith(2, "2001");
  });

  it("test_extra_ 読み取りに失敗しても止まらない", async () => {
    installBarcodeDetector(["code_128"]);
    const onDetect = jest.fn();
    detector.detect.mockRejectedValueOnce(new Error("frame not ready")).mockResolvedValueOnce([{ rawValue: "2001" }]);
    render(<BarcodeScanner onDetect={onDetect} now={() => 0} />);
    await flush();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(onDetect).toHaveBeenCalledWith("2001");
  });

  it("test_extra_ 画面を離れたらカメラを止める", async () => {
    installBarcodeDetector(["code_128"]);
    const { unmount } = render(<BarcodeScanner onDetect={jest.fn()} now={() => 0} />);
    await flush();
    unmount();
    expect(trackStop).toHaveBeenCalled();
  });

  it("test_extra_ カメラの起動を待つ間に画面を離れても、起動後にカメラを止める", async () => {
    installBarcodeDetector(["code_128"]);
    let resolveStream: (value: MediaStream) => void = () => {};
    getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => { resolveStream = resolve; }));
    const { unmount } = render(<BarcodeScanner onDetect={jest.fn()} now={() => 0} />);
    await flush();
    unmount();
    await act(async () => {
      resolveStream(stream);
    });
    await flush();
    expect(trackStop).toHaveBeenCalled();
  });

  it("test_extra_ カメラを使えなければ手入力を案内する", async () => {
    installBarcodeDetector(["code_128"]);
    getUserMedia.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    render(<BarcodeScanner onDetect={jest.fn()} now={() => 0} />);
    await flush();
    expect(screen.getByText("カメラを利用できません。商品コード・会員IDを手入力してください")).toBeInTheDocument();
  });
});

describe("ZXing（非対応ブラウザでの代替）", () => {
  const controls = { stop: jest.fn() };

  it.each([
    { label: "Barcode Detection API がない", setup: () => {} },
    { label: "Code128 に対応していない", setup: () => installBarcodeDetector(["qr_code"]) },
  ])("test_extra_ $label ときは ZXing で Code128 を読み取る", async ({ setup }) => {
    setup();
    mockDecodeFromConstraints.mockResolvedValue(controls);
    const onDetect = jest.fn();
    const { unmount } = render(<BarcodeScanner onDetect={onDetect} now={() => 0} />);
    await flush();

    const hints = mockReaderConstructor.mock.calls[0][0] as Map<number, unknown>;
    expect(hints.get(2)).toEqual([4]); // POSSIBLE_FORMATS = [CODE_128]
    const [constraints, video, callback] = mockDecodeFromConstraints.mock.calls[0];
    expect(constraints).toEqual({ video: { facingMode: "environment" }, audio: false });
    expect(video).toBeInstanceOf(HTMLVideoElement);

    act(() => {
      callback(undefined, undefined, controls); // 読めないフレームも 1 フレームとして渡す
      callback({ getText: () => "M000001" }, undefined, controls);
      callback({ getText: () => "M000001" }, undefined, controls); // かざしたまま
    });
    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(onDetect).toHaveBeenCalledWith("M000001");
    expect(screen.getByText("スキャン中（ZXing）")).toBeInTheDocument();

    unmount();
    expect(controls.stop).toHaveBeenCalled();
  });

  it("test_extra_ ZXing でも、読めなかったフレームを空として渡すので「離した」判定ができる", async () => {
    mockDecodeFromConstraints.mockResolvedValue(controls);
    let now = 0;
    const onDetect = jest.fn();
    render(<BarcodeScanner onDetect={onDetect} now={() => now} />);
    await flush();
    const callback = mockDecodeFromConstraints.mock.calls[0][2];
    const result = { getText: () => "1001" };

    act(() => {
      callback(result, undefined, controls);
    });
    expect(onDetect).toHaveBeenCalledTimes(1);

    // 読めないフレームが5回、最後の検出から 1.0秒以上
    act(() => {
      for (let i = 1; i <= 5; i += 1) {
        now = i * 200;
        callback(undefined, undefined, controls);
      }
      now = 1200;
      callback(result, undefined, controls);
    });
    expect(onDetect).toHaveBeenCalledTimes(2);
  });

  it("test_extra_ ZXing でもカメラを使えなければ手入力を案内する", async () => {
    mockDecodeFromConstraints.mockRejectedValue(new Error("no camera"));
    render(<BarcodeScanner onDetect={jest.fn()} now={() => 0} />);
    await flush();
    expect(screen.getByText("カメラを利用できません。商品コード・会員IDを手入力してください")).toBeInTheDocument();
  });
});
