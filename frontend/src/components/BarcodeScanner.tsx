"use client";

// カメラ映像エリア（requirements.md 5.3、7章④）。レジ画面では常時表示し、1回ごとに終了させない
// Code128 を Barcode Detection API で読み取り、非対応のブラウザでは ZXing に切り替える（design.md 2.2）
import { useEffect, useRef, useState } from "react";

import { CLIENT_MESSAGES } from "@/lib/messages";
import {
  getSharedScanStatesRef,
  nextScanState,
  pickCenterMost,
  type AcceptReason,
  type ScannedBarcode,
} from "@/lib/scanGate";

import styles from "./BarcodeScanner.module.css";

const SCAN_INTERVAL_MS = 200;
const VIDEO_CONSTRAINTS: MediaStreamConstraints = { video: { facingMode: "environment" }, audio: false };

type Status = "starting" | "scanning" | "unavailable";
type StopScanner = () => void;
// 読み取りに使っている仕組み。どちらで動いているか画面に出す
type Engine = "BarcodeDetector" | "ZXing";
type StartedScanner = { stop: StopScanner; engine: Engine };

type Props = {
  onDetect: (code: string) => void;
  // 重複防止の時刻。テストで差し替える
  now?: () => number;
  // 開発環境のときだけ、判定の状態を画面とコンソールに出す（design.md 6.4）。本番では渡さない
  debug?: boolean;
};

// 開発環境の表示に出す値
type Diagnostics = {
  frames: number; // 読み取りループの実行回数（累計）
  framesPerSecond: number;
  accepted: number; // 受け付けた（追加が発生した）回数
  detectedCount: number; // このフレームの検出数
  detectedCodes: string[]; // このフレームで検出したコードの一覧
  picked: string | null; // 採用したコード（中心に最も近いもの）
  sinceLastSeenMs: number | null;
  misses: number;
  released: boolean;
  stableFrames: number; // 採用中のコードが連続して採用されたフレーム数
  tracked: number; // 状態を持っているコード数
  lastReason: AcceptReason | null;
};

const DIAGNOSTICS_INTERVAL_MS = 500;

// 映像1フレーム分の読み取り結果（何も読めなければ空）。複数写ることがある
type OnFrame = (barcodes: ScannedBarcode[]) => void;

const supportsNativeCode128 = async (): Promise<boolean> => {
  const Detector = window.BarcodeDetector;
  if (!Detector) {
    return false;
  }
  return (await Detector.getSupportedFormats()).includes("code_128");
};

const startNativeScanner = async (video: HTMLVideoElement, onFrame: OnFrame): Promise<StartedScanner> => {
  const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };

  video.srcObject = stream;
  await video.play();
  const detector = new (window.BarcodeDetector as BarcodeDetectorConstructor)({ formats: ["code_128"] });

  const tick = async () => {
    try {
      const barcodes = (await detector.detect(video)).map((barcode) => ({
        rawValue: barcode.rawValue,
        boundingBox: barcode.boundingBox,
      }));
      if (stopped) {
        // 止めたあとに届いたフレームは捨てる（古いループの結果を混ぜない）
        return;
      }
      onFrame(barcodes);
    } catch {
      // 映像の準備前などは次の周期で読み直す。読めなかったことは「離した」と扱わない
    }
    if (!stopped) {
      timer = setTimeout(tick, SCAN_INTERVAL_MS);
    }
  };
  void tick();
  return { stop, engine: "BarcodeDetector" };
};

const startZxingScanner = async (video: HTMLVideoElement, onFrame: OnFrame): Promise<StartedScanner> => {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]);
  const reader = new BrowserMultiFormatReader(hints);
  let stopped = false;
  const controls = await reader.decodeFromConstraints(VIDEO_CONSTRAINTS, video, (result) => {
    if (stopped) {
      return;
    }
    // 読めたかどうかに関わらず、1フレームとして必ず渡す。空のフレームが「離した」の判定材料になる
    // ZXing は1フレームにつき1件しか返さないため、そのまま採用される
    onFrame(result ? [{ rawValue: result.getText() }] : []);
  });
  return {
    stop: () => {
      stopped = true;
      controls.stop();
    },
    engine: "ZXing",
  };
};

export function BarcodeScanner({ onDetect, now = () => performance.now(), debug = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [engine, setEngine] = useState<Engine | null>(null);
  const onDetectRef = useRef(onDetect);
  const nowRef = useRef(now);
  const debugRef = useRef(debug);
  // 重複防止の状態（最後に見えた時刻・見えなかったフレーム数）は作り直さない。
  // 再描画で消えないよう ref に保持し、コンポーネントごと作り直された場合に備えて画面で1つの実体を共有する
  // lastCode・lastSeenAt・misses・released は ref で保持する。再描画でも、
  // カメラの部品が作り直されても失わないよう、画面で1つの入れ物を共有する
  const statesRef = useRef(getSharedScanStatesRef());
  const lastReasonRef = useRef<AcceptReason | null>(null);
  const lastFrameRef = useRef<{ codes: string[]; picked: string | null }>({ codes: [], picked: null });
  // 開発環境の表示用。フレームごとに再描画しないよう、数えるだけにして一定間隔で画面に反映する
  const countsRef = useRef({ frames: 0, accepted: 0, lastShownAt: 0, lastShownFrames: 0 });
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  useEffect(() => {
    onDetectRef.current = onDetect;
    nowRef.current = now;
    debugRef.current = debug;
  });

  // 開発環境のときだけ、判定の状態を定期的に画面へ反映する
  useEffect(() => {
    if (!debug) {
      return;
    }
    const scanStates = statesRef.current;
    const counts = countsRef.current;
    counts.lastShownAt = nowRef.current();
    counts.lastShownFrames = counts.frames;

    const timer = setInterval(() => {
      const at = nowRef.current();
      const elapsed = at - counts.lastShownAt;
      const framesPerSecond = elapsed > 0 ? ((counts.frames - counts.lastShownFrames) * 1000) / elapsed : 0;
      counts.lastShownAt = at;
      counts.lastShownFrames = counts.frames;
      const frame = lastFrameRef.current;
      const state = frame.picked === null ? undefined : scanStates.current.get(frame.picked);
      setDiagnostics({
        frames: counts.frames,
        framesPerSecond: Math.round(framesPerSecond * 10) / 10,
        accepted: counts.accepted,
        detectedCount: frame.codes.length,
        detectedCodes: frame.codes,
        picked: frame.picked,
        sinceLastSeenMs: state === undefined ? null : Math.round(at - state.lastSeenAt),
        misses: state?.misses ?? 0,
        released: state?.released ?? false,
        stableFrames: state?.stableFrames ?? 0,
        tracked: scanStates.current.size,
        lastReason: lastReasonRef.current,
      });
    }, DIAGNOSTICS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [debug]);

  useEffect(() => {
    const video = videoRef.current as HTMLVideoElement;
    let cancelled = false;
    let stopScanner: StopScanner | null = null;
    const scanStates = statesRef.current;

    // BarcodeDetector・ZXing のどちらの経路も、このひとつの関数を通る
    const handleFrame = (barcodes: ScannedBarcode[]) => {
      // 片付け済みのループからのフレームは無視する（二重に起動していても追加されない）
      if (cancelled) {
        return;
      }
      const at = nowRef.current();
      countsRef.current.frames += 1;
      // 1フレームに複数写っていたら、映像の中心に最も近い1件だけを採用する
      const picked = pickCenterMost(barcodes, video.videoWidth, video.videoHeight);
      const codes = barcodes.map((barcode) => barcode.rawValue);
      lastFrameRef.current = { codes, picked };
      // 写っているコードはすべて渡す（採用されなかったものも「見えている」として扱う）
      const decision = nextScanState(scanStates.current, codes, picked, at);
      scanStates.current = decision.states;
      if (decision.accepted === null) {
        return;
      }
      countsRef.current.accepted += 1;
      lastReasonRef.current = decision.reason;
      if (debugRef.current) {
        // eslint-disable-next-line no-console
        console.info(
          `[scan] 受付 ${decision.accepted}（${decision.reason}、離れていた時間 ${
            decision.awayMs === null ? "—" : `${decision.awayMs}ms`
          }、misses=${decision.awayMisses}、安定=${decision.stableFramesAtAccept}フレーム）`,
        );
      }
      onDetectRef.current(decision.accepted);
    };

    const start = async () =>
      (await supportsNativeCode128()) ? startNativeScanner(video, handleFrame) : startZxingScanner(video, handleFrame);

    start().then(
      ({ stop, engine: started }) => {
        // 起動を待つ間に画面を離れていたら、すぐにカメラを止める
        if (cancelled) {
          stop();
          return;
        }
        stopScanner = stop;
        setEngine(started);
        setStatus("scanning");
      },
      () => {
        if (!cancelled) {
          setStatus("unavailable");
        }
      },
    );

    return () => {
      cancelled = true;
      stopScanner?.();
    };
  }, []);

  const statusText =
    status === "scanning"
      ? `スキャン中（${engine}）`
      : status === "starting"
        ? "カメラ起動中"
        : CLIENT_MESSAGES.CAMERA_UNAVAILABLE;

  return (
    <section className={styles.scanner} aria-label="カメラ">
      <video ref={videoRef} className={styles.video} muted playsInline />
      <p className={status === "unavailable" ? styles.unavailable : styles.status}>{statusText}</p>
      {debug && diagnostics !== null ? (
        <dl className={styles.diagnostics} aria-label="読み取りの状態（開発用）">
          <div>
            <dt>経路</dt>
            <dd>{engine ?? "—"}</dd>
          </div>
          <div>
            <dt>読み取り/秒</dt>
            <dd>{`${diagnostics.framesPerSecond}（累計 ${diagnostics.frames}）`}</dd>
          </div>
          <div>
            <dt>検出数</dt>
            <dd>{`${diagnostics.detectedCount}（${
              diagnostics.detectedCodes.length === 0 ? "—" : diagnostics.detectedCodes.join(" / ")
            }）`}</dd>
          </div>
          <div>
            <dt>採用</dt>
            <dd>
              {diagnostics.picked === null
                ? "—"
                : `${diagnostics.picked}（${diagnostics.sinceLastSeenMs}ms 前）`}
            </dd>
          </div>
          <div>
            <dt>安定</dt>
            <dd>{`${diagnostics.stableFrames}フレーム`}</dd>
          </div>
          <div>
            <dt>管理中</dt>
            <dd>{`${diagnostics.tracked}件`}</dd>
          </div>
          <div>
            <dt>misses</dt>
            <dd>{`${diagnostics.misses}${diagnostics.released ? "（離した）" : ""}`}</dd>
          </div>
          <div>
            <dt>受付</dt>
            <dd>{`${diagnostics.accepted}回${diagnostics.lastReason === null ? "" : `（直近：${diagnostics.lastReason}）`}`}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
