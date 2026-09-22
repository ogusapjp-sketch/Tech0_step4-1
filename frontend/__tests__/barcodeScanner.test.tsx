/** @jest-environment jsdom */
// カメラによるバーコード読み取り（design.md 2.2、requirements.md 5.3・7章④）
// Code128 を Barcode Detection API で読み、非対応なら ZXing に切り替える（人間が決定）。test_extra_
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";

import { BarcodeScanner } from "@/components/BarcodeScanner";
import { resetSharedScanStates } from "@/lib/scanGate";

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

// 映像 640x480 の中心 (320,240) に近いもの／遠いもの
const NEAR_1004 = { rawValue: "1004", boundingBox: { x: 280, y: 210, width: 80, height: 40 } };
const FAR_1002 = { rawValue: "1002", boundingBox: { x: 10, y: 10, width: 80, height: 40 } };

type DetectorMock = { detect: jest.Mock };
let detector: DetectorMock;

const installBarcodeDetector = (formats: string[]) => {
  detector = { detect: jest.fn().mockResolvedValue([]) };
  const ctor = jest.fn().mockImplementation(() => detector) as unknown as { getSupportedFormats: jest.Mock };
  ctor.getSupportedFormats = jest.fn().mockResolvedValue(formats);
  Object.defineProperty(window, "BarcodeDetector", { value: ctor, configurable: true, writable: true });
  return ctor;
};

// 読み取りを1フレーム進める（読み取りの周期は 200ms）
const tick = async (ms = 200) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  });
};

beforeEach(() => {
  resetSharedScanStates();
  jest.useFakeTimers();
  jest.clearAllMocks();
  getUserMedia.mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  // 映像は 640x480（中心は 320,240）。1フレームに複数写ったときの採用判定に使う
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { value: 640, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { value: 480, configurable: true });
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
    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    await flush();
    await tick();
    await tick(); // 連続3フレーム中心にあると受け付ける（STABLE_FRAMES）

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

    // かざしたまま：3フレーム目で1回受け付け、そのあとは何周期たっても受け付けない
    for (let i = 1; i <= 30; i += 1) {
      now = i * 200;
      await tick();
    }
    expect(onDetect).toHaveBeenCalledTimes(1);
  });

  it("test_extra_ 3000ms 以上・連続12フレーム読めなくなったら、同じコードをもう一度読み取れる", async () => {
    installBarcodeDetector(["code_128"]);
    let now = 0;
    const onDetect = jest.fn();
    const frame = async (codes: string[]) => {
      now += 250;
      detector.detect.mockResolvedValue(codes.map((rawValue) => ({ rawValue })));
      await tick(250);
    };

    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    render(<BarcodeScanner onDetect={onDetect} now={() => now} />);
    await flush();
    await frame(["1001"]);
    await frame(["1001"]); // 3フレーム続いたので受け付ける
    expect(onDetect).toHaveBeenCalledTimes(1);

    // 読み取りが11フレームだけ途切れても解除しない
    for (let i = 0; i < 11; i += 1) {
      await frame([]);
    }
    await frame(["1001"]);
    await frame(["1001"]);
    await frame(["1001"]);
    expect(onDetect).toHaveBeenCalledTimes(1);

    // 12フレーム連続で読めず、最後の検出から 3000ms 以上たったら受け付ける
    for (let i = 0; i < 12; i += 1) {
      await frame([]);
    }
    await frame(["1001"]);
    await frame(["1001"]);
    await frame(["1001"]);
    expect(onDetect).toHaveBeenCalledTimes(2);
    expect(onDetect).toHaveBeenNthCalledWith(2, "1001");
  });

  it("test_extra_ 中心が別のコードに3フレーム続いたら、そのコードを受け付ける", async () => {
    installBarcodeDetector(["code_128"]);
    let now = 0;
    const onDetect = jest.fn();
    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    render(<BarcodeScanner onDetect={onDetect} now={() => now} />);
    await flush();
    now = 200;
    await tick();
    now = 400;
    await tick();

    detector.detect.mockResolvedValue([{ rawValue: "2001" }]);
    for (let i = 1; i <= 3; i += 1) {
      now = 400 + i * 200;
      await tick();
    }
    expect(onDetect).toHaveBeenNthCalledWith(1, "1001");
    expect(onDetect).toHaveBeenNthCalledWith(2, "2001");
    expect(onDetect).toHaveBeenCalledTimes(2);
  });

  it("test_extra_ 追加による再描画をはさんでも、かざしたままなら追加されない", async () => {
    // 商品を追加すると親が再描画される。そのたびに重複防止の状態が消えないことの確認
    installBarcodeDetector(["code_128"]);
    let now = 0;
    const detected: string[] = [];

    function Harness() {
      const [lines, setLines] = useState<string[]>([]);
      return (
        <div>
          <p>{`行数:${lines.length}`}</p>
          <BarcodeScanner
            onDetect={(code) => {
              detected.push(code);
              setLines((current) => [...current, code]); // 追加＝state 更新＝再描画
            }}
            now={() => now}
          />
        </div>
      );
    }

    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    render(<Harness />);
    await flush();

    // かざしたまま 30フレーム（6秒ぶん）。3フレーム目で1回追加され、そのあとは再描画が起きても増えない
    for (let i = 0; i < 30; i += 1) {
      now += 200;
      await tick();
    }
    expect(detected).toEqual(["1001"]);
    expect(screen.getByText("行数:1")).toBeInTheDocument();
  });

  it("test_extra_ コンポーネントが作り直されても、かざしたままなら追加されない", async () => {
    // 再マウントで重複防止の状態が消えないことの確認（状態は画面で1つだけ持つ）
    installBarcodeDetector(["code_128"]);
    let now = 0;
    const onDetect = jest.fn();
    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    const { unmount } = render(<BarcodeScanner onDetect={onDetect} now={() => now} />);
    await flush();
    now = 200;
    await tick();
    now = 400;
    await tick();
    expect(onDetect).toHaveBeenCalledTimes(1);

    unmount();
    now = 600;
    render(<BarcodeScanner onDetect={onDetect} now={() => now} />);
    await flush();
    for (let i = 0; i < 10; i += 1) {
      now += 200;
      await tick();
    }
    expect(onDetect).toHaveBeenCalledTimes(1);
  });

  it("test_extra_ 画面を離れたあとのフレームでは追加しない（読み取りループの多重起動を防ぐ）", async () => {
    installBarcodeDetector(["code_128"]);
    const onDetect = jest.fn();
    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    const { unmount } = render(<BarcodeScanner onDetect={onDetect} now={() => 0} />);
    await flush();
    await tick();
    await tick();
    expect(onDetect).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(onDetect).toHaveBeenCalledTimes(1);
  });

  it("test_extra_ 1フレームに2つ写っていても、中心に近い1つだけを受け付ける", async () => {
    // 早見表のように複数のカードが並ぶ場合。並び順が入れ替わっても採用は変わらない
    installBarcodeDetector(["code_128"]);
    let now = 0;
    const onDetect = jest.fn();
    detector.detect.mockResolvedValue([FAR_1002, NEAR_1004]);
    render(<BarcodeScanner onDetect={onDetect} now={() => now} debug={false} />);
    await flush();

    for (let i = 1; i <= 20; i += 1) {
      now = i * 250;
      detector.detect.mockResolvedValue(i % 2 === 0 ? [NEAR_1004, FAR_1002] : [FAR_1002, NEAR_1004]);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(250);
      });
    }

    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(onDetect).toHaveBeenCalledWith("1004");
  });

  it("test_extra_ 読み取りに失敗しても止まらない", async () => {
    installBarcodeDetector(["code_128"]);
    const onDetect = jest.fn();
    detector.detect.mockRejectedValueOnce(new Error("frame not ready")).mockResolvedValue([{ rawValue: "2001" }]);
    render(<BarcodeScanner onDetect={onDetect} now={() => 0} />);
    await flush();
    for (let i = 0; i < 3; i += 1) {
      await tick();
    }
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

describe("開発環境の状態表示（design.md 6.4）", () => {
  it("test_extra_ debug のときは経路・検出数・検出コード・採用・misses・受付回数を表示する", async () => {
    installBarcodeDetector(["code_128"]);
    let now = 0;
    detector.detect.mockResolvedValue([FAR_1002, NEAR_1004]);
    render(<BarcodeScanner onDetect={jest.fn()} now={() => now} debug />);
    await flush();
    now = 600;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(600);
    });

    const panel = screen.getByLabelText("読み取りの状態（開発用）");
    expect(panel).toHaveTextContent("BarcodeDetector");
    expect(panel).toHaveTextContent("1002 / 1004"); // このフレームの検出コード
    expect(panel).toHaveTextContent("1004"); // 採用したのは中心に近い方
    expect(panel).toHaveTextContent("1回（直近：初出）");
  });

  it("test_extra_ まだ何も読めていないときは「—」を表示する", async () => {
    installBarcodeDetector(["code_128"]);
    let now = 0;
    detector.detect.mockResolvedValue([]);
    render(<BarcodeScanner onDetect={jest.fn()} now={() => now} debug />);
    await flush();
    now = 600;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(600);
    });

    const panel = screen.getByLabelText("読み取りの状態（開発用）");
    expect(panel).toHaveTextContent("—");
    expect(panel).toHaveTextContent("0回");
  });

  it("test_extra_ debug のときは受け付けるたびにコンソールへ出す", async () => {
    installBarcodeDetector(["code_128"]);
    const info = jest.spyOn(console, "info").mockImplementation(() => {});
    let now = 0;
    // 読み取りの周期に合わせて 200ms ずつ進める
    const frame = async (codes: string[]) => {
      now += 200;
      detector.detect.mockResolvedValue(codes.map((rawValue) => ({ rawValue })));
      await tick();
    };

    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    render(<BarcodeScanner onDetect={jest.fn()} now={() => now} debug />);
    await flush();
    await frame(["1001"]);
    await frame(["1001"]);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("[scan] 受付 1001（初出、離れていた時間 —"));

    // 読めない状態が 3000ms（200ms × 15フレーム）続いてから、もう一度3フレーム検出する
    for (let i = 0; i < 15; i += 1) {
      await frame([]);
    }
    await frame(["1001"]);
    await frame(["1001"]);
    await frame(["1001"]);
    expect(info).toHaveBeenLastCalledWith(
      expect.stringContaining("離した後の再受付、離れていた時間 3000ms、misses=15、安定=3フレーム"),
    );
  });

  it("test_extra_ 本番（debug なし）では表示もコンソール出力もしない", async () => {
    installBarcodeDetector(["code_128"]);
    const info = jest.spyOn(console, "info").mockImplementation(() => {});
    let now = 0;
    detector.detect.mockResolvedValue([{ rawValue: "1001" }]);
    render(<BarcodeScanner onDetect={jest.fn()} now={() => now} />);
    await flush();
    now = 1000;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });

    expect(screen.queryByLabelText("読み取りの状態（開発用）")).not.toBeInTheDocument();
    expect(info).not.toHaveBeenCalled();
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
      for (let i = 0; i < 5; i += 1) {
        callback({ getText: () => "M000001" }, undefined, controls); // 3フレーム目で受け付け、以後はかざしたまま
      }
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
      for (let i = 1; i <= 3; i += 1) {
        now = i * 250;
        callback(result, undefined, controls);
      }
    });
    expect(onDetect).toHaveBeenCalledTimes(1);

    // 読めないフレームが12回、最後の検出から 3000ms 以上
    act(() => {
      for (let i = 1; i <= 12; i += 1) {
        now = 750 + i * 250;
        callback(undefined, undefined, controls);
      }
      for (let i = 1; i <= 3; i += 1) {
        now = 3750 + i * 250;
        callback(result, undefined, controls);
      }
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
