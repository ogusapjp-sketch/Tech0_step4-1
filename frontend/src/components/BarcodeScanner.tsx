"use client";

// カメラ映像エリア（requirements.md 5.3、7章④）。レジ画面では常時表示し、1回ごとに終了させない
// Code128 を Barcode Detection API で読み取り、非対応のブラウザでは ZXing に切り替える（design.md 2.2）
import { useEffect, useRef, useState } from "react";

import { CLIENT_MESSAGES } from "@/lib/messages";
import { acceptScan, type LastScan } from "@/lib/scanCooldown";

import styles from "./BarcodeScanner.module.css";

const SCAN_INTERVAL_MS = 200;
const VIDEO_CONSTRAINTS: MediaStreamConstraints = { video: { facingMode: "environment" }, audio: false };

type Status = "starting" | "scanning" | "unavailable";
type StopScanner = () => void;

type Props = {
  onDetect: (code: string) => void;
  // 重複防止の時刻。テストで差し替える
  now?: () => number;
};

const supportsNativeCode128 = async (): Promise<boolean> => {
  const Detector = window.BarcodeDetector;
  if (!Detector) {
    return false;
  }
  return (await Detector.getSupportedFormats()).includes("code_128");
};

const startNativeScanner = async (video: HTMLVideoElement, handle: (code: string) => void): Promise<StopScanner> => {
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
      for (const barcode of await detector.detect(video)) {
        handle(barcode.rawValue);
      }
    } catch {
      // 映像の準備前などは次の周期で読み直す
    }
    if (!stopped) {
      timer = setTimeout(tick, SCAN_INTERVAL_MS);
    }
  };
  void tick();
  return stop;
};

const startZxingScanner = async (video: HTMLVideoElement, handle: (code: string) => void): Promise<StopScanner> => {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]);
  const reader = new BrowserMultiFormatReader(hints);
  const controls = await reader.decodeFromConstraints(VIDEO_CONSTRAINTS, video, (result) => {
    if (result) {
      handle(result.getText());
    }
  });
  return () => controls.stop();
};

export function BarcodeScanner({ onDetect, now = () => performance.now() }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>("starting");
  const onDetectRef = useRef(onDetect);
  const nowRef = useRef(now);

  useEffect(() => {
    onDetectRef.current = onDetect;
    nowRef.current = now;
  });

  useEffect(() => {
    const video = videoRef.current as HTMLVideoElement;
    let cancelled = false;
    let stopScanner: StopScanner | null = null;
    let lastScan: LastScan | null = null;

    const handle = (code: string) => {
      const at = nowRef.current();
      if (!acceptScan(lastScan, code, at)) {
        return;
      }
      lastScan = { code, at };
      onDetectRef.current(code);
    };

    const start = async () =>
      (await supportsNativeCode128()) ? startNativeScanner(video, handle) : startZxingScanner(video, handle);

    start().then(
      (stop) => {
        // 起動を待つ間に画面を離れていたら、すぐにカメラを止める
        if (cancelled) {
          stop();
          return;
        }
        stopScanner = stop;
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
    status === "scanning" ? "スキャン中" : status === "starting" ? "カメラ起動中" : CLIENT_MESSAGES.CAMERA_UNAVAILABLE;

  return (
    <section className={styles.scanner} aria-label="カメラ">
      <video ref={videoRef} className={styles.video} muted playsInline />
      <p className={status === "unavailable" ? styles.unavailable : styles.status}>{statusText}</p>
    </section>
  );
}
