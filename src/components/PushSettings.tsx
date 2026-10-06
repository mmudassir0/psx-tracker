"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  testPushAction,
  type ActionState,
} from "@/app/actions";

type Status = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on";

const button =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";

/** VAPID public keys are URL-safe base64; the Push API wants raw bytes. */
function keyToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : isIos() ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export function PushSettings({
  publicKey,
  devices,
}: {
  publicKey: string;
  /** Devices already subscribed for this account (any browser). */
  devices: { endpoint: string; device: string | null }[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionState | null>(null);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: Status;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        next = isIos() && !isInstalled() ? "ios-install" : "unsupported";
      } else if (Notification.permission === "denied") {
        next = "denied";
      } else {
        const sub = await currentSubscription().catch(() => null);
        const known = sub && devices.some((d) => d.endpoint === sub.endpoint);
        if (!cancelled) setThisEndpoint(known ? sub.endpoint : null);
        next = known ? "on" : "off";
      }
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [devices]);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        setMessage({ ok: false, message: "Notifications weren't allowed." });
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
      const result = await savePushSubscriptionAction(sub.toJSON(), deviceLabel());
      setMessage(result);
      if (result.ok) {
        setThisEndpoint(sub.endpoint);
        setStatus("on");
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, message: "This browser couldn't turn on notifications." });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const sub = await currentSubscription();
      const endpoint = sub?.endpoint ?? thisEndpoint;
      await sub?.unsubscribe();
      if (endpoint) setMessage(await removePushSubscriptionAction(endpoint));
      setThisEndpoint(null);
      setStatus("off");
      router.refresh();
    } catch {
      setMessage({ ok: false, message: "Couldn't turn notifications off." });
    } finally {
      setBusy(false);
    }
  }

  const others = devices.filter((d) => d.endpoint !== thisEndpoint);

  return (
    <div className="flex flex-col gap-2">
      {status === "checking" && <p className="text-sm text-slate-500">Checking this browser…</p>}
      {status === "unsupported" && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          This browser can&apos;t receive notifications. Chrome, Edge, Firefox and Safari can.
        </p>
      )}
      {status === "ios-install" && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          On iPhone and iPad, first add this site to your home screen: tap the Share button, then
          &ldquo;Add to Home Screen&rdquo;. Open it from there and come back to this page.
        </p>
      )}
      {status === "denied" && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Notifications are blocked for this site. Allow them in the browser&apos;s site settings (the
          icon left of the address bar), then reload.
        </p>
      )}
      {status === "off" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Get your alerts as notifications on this device, even with the site closed.
          </p>
          <button type="button" onClick={enable} disabled={busy} className={`${button} self-start`}>
            {busy ? "Turning on…" : "Turn on notifications"}
          </button>
        </div>
      )}
      {status === "on" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600 dark:text-slate-400">On for this device.</span>
          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={async () => {
              setBusy(true);
              setMessage(await testPushAction());
              setBusy(false);
            }}
          >
            Send a test
          </button>
          <button
            type="button"
            onClick={disable}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            Turn off here
          </button>
        </div>
      )}
      {others.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Also on: {others.map((d) => d.device ?? "another device").join(", ")}.
        </p>
      )}
      {message?.message && (
        <p role="status" className={`text-sm ${message.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {message.message}
        </p>
      )}
    </div>
  );
}
