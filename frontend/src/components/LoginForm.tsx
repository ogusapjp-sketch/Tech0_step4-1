"use client";

// ログイン画面（requirements.md 5.3 SR-001、FR-001）
// 認証失敗の文言は、担当者IDとパスワードのどちらが誤りかを区別しない（NFR-SEC-05）
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { api } from "@/lib/api";
import { CLIENT_MESSAGES, messageForError } from "@/lib/messages";

import styles from "./LoginForm.module.css";

// design.md 6.1：担当者ID 1〜20文字（英数字と - _）、パスワード 12〜128文字
const STAFF_ID_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

export function LoginForm() {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 文字数は Unicode のコードポイント単位で数える（バックエンドと同じ）
    const passwordLength = [...password].length;
    if (!STAFF_ID_PATTERN.test(staffId) || passwordLength < PASSWORD_MIN || passwordLength > PASSWORD_MAX) {
      setError(CLIENT_MESSAGES.INVALID_LOGIN_INPUT);
      return;
    }

    setSubmitting(true);
    const result = await api.login(staffId, password);
    setSubmitting(false);

    if (result.kind === "ok") {
      router.replace("/");
      router.refresh();
      return;
    }
    setPassword("");
    if (result.kind === "network") {
      setError(CLIENT_MESSAGES.NETWORK);
    } else if (result.code === "VALIDATION_ERROR") {
      setError(CLIENT_MESSAGES.INVALID_LOGIN_INPUT);
    } else {
      setError(messageForError(result.code));
    }
  };

  return (
    <main className={styles.page}>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>唯我独尊 レジ</h1>
        <label className={styles.field}>
          担当者ID
          <input value={staffId} onChange={(event) => setStaffId(event.target.value)} autoComplete="username" />
        </label>
        <label className={styles.field}>
          パスワード
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <button type="submit" className={styles.submit} disabled={submitting}>
          ログイン
        </button>
      </form>
    </main>
  );
}
