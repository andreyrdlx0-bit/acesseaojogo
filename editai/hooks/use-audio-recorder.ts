"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "paused" | "recorded" | "error";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

const MAX_SECONDS = 180;

/**
 * Gravação de áudio (MediaRecorder) com iniciar/pausar/continuar/cancelar.
 * Em paralelo, usa a Web Speech API do navegador (quando existe) para gerar
 * uma transcrição local — usada como fallback se o servidor não tiver STT.
 */
export function useAudioRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const finalText = useRef("");
  const analyserFrame = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const cancelled = useRef(false);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (analyserFrame.current) cancelAnimationFrame(analyserFrame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    recognition.current?.stop();
    void audioCtx.current?.close().catch(() => undefined);
    timer.current = null;
    stream.current = null;
    audioCtx.current = null;
    setLevel(0);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const startTimer = () => {
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) recorder.current?.stop();
        return s + 1;
      });
    }, 1000);
  };

  const start = useCallback(async () => {
    setError(null);
    setBlob(null);
    setUrl(null);
    setSeconds(0);
    setLiveTranscript("");
    finalText.current = "";
    cancelled.current = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("error");
      setError("Seu navegador não permite gravar áudio. Escreva sua instrução.");
      return;
    }
    setState("requesting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        cleanup();
        if (cancelled.current) return;
        const b = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        setBlob(b);
        setUrl(URL.createObjectURL(b));
        setState("recorded");
      };
      rec.start(250);
      recorder.current = rec;

      // Nível do microfone para a visualização.
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(media).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        setLevel(data.reduce((a, v) => a + v, 0) / data.length / 255);
        analyserFrame.current = requestAnimationFrame(loop);
      };
      loop();

      // Transcrição local (fallback honesto, marcada como "browser" no servidor).
      const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
      if (SR) {
        const r = new SR();
        r.lang = "pt-BR";
        r.continuous = true;
        r.interimResults = true;
        r.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i]!;
            if (res.isFinal) finalText.current += `${res[0].transcript} `;
            else interim += res[0].transcript;
          }
          setLiveTranscript(`${finalText.current}${interim}`.trim());
        };
        r.onerror = () => undefined;
        try {
          r.start();
          recognition.current = r;
        } catch {
          recognition.current = null;
        }
      }
      startTimer();
      setState("recording");
    } catch {
      cleanup();
      setState("error");
      setError("Não conseguimos acessar o microfone. Verifique a permissão do navegador.");
    }
  }, [cleanup]);

  const pause = useCallback(() => {
    if (recorder.current?.state !== "recording") return;
    recorder.current.pause();
    if (timer.current) clearInterval(timer.current);
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    if (recorder.current?.state !== "paused") return;
    recorder.current.resume();
    startTimer();
    setState("recording");
  }, []);

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    cleanup();
    setBlob(null);
    setUrl(null);
    setSeconds(0);
    setLiveTranscript("");
    setState("idle");
  }, [cleanup]);

  return { state, seconds, blob, url, liveTranscript, error, level, start, pause, resume, stop, cancel, maxSeconds: MAX_SECONDS };
}
