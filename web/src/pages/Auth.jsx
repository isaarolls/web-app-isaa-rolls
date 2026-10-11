import React, { useState } from "react";
import { api, setToken } from "../api.js";
import { Button, Field, Input, Notice, PageHeader, navigate, useApp } from "../ui.jsx";

function LoginArt({ title, text }) {
  return (
    <div className="login-art">
      <img className="login-logo" src="logo.png" alt="Isaa Rolls" />
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}

export function Login({ onLogin }) {
  const { toast } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [forgot, setForgot] = useState(false);
  const [info, setInfo] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (forgot) {
        const r = await api.post("/auth/forgot", { email });
        setInfo(r.message);
      } else {
        const r = await api.post("/auth/login", { email, password });
        setToken(r.token);
        await onLogin();
      }
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="login-page">
      <LoginArt title="Il laboratorio, i conti e la cassa in un posto solo" text="Accedi con le tue credenziali personali. Ogni operazione viene registrata con il tuo nome." />
      <div className="login-form">
        <form onSubmit={submit}>
          <h2 style={{ fontSize: 24 }}>{forgot ? "Recupera la password" : "Accedi"}</h2>
          {error && <Notice tone="bad">{error}</Notice>}
          {info && <Notice tone="info">{info}</Notice>}
          <Field label="E-mail">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          {!forgot && (
            <Field label="Password">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <Button variant="primary" size="lg" busy={busy} type="submit">{forgot ? "Invia istruzioni" : "Accedi"}</Button>
          <button type="button" className="btn btn-ghost" onClick={() => { setForgot(!forgot); setError(null); setInfo(null); }}>
            {forgot ? "Torna all'accesso" : "Hai dimenticato la password?"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function ResetPassword({ token }) {
  const { toast } = useApp();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) { setError("Le due password non coincidono"); return; }
    setBusy(true); setError(null);
    try {
      await api.post("/auth/reset", { token, new_password: pw });
      toast("Password aggiornata: ora puoi accedere", "ok");
      navigate("/");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-page">
      <LoginArt title="Scegli una nuova password" text="Almeno 10 caratteri, con maiuscole, minuscole e un numero." />
      <div className="login-form">
        <form onSubmit={submit}>
          <h2 style={{ fontSize: 24 }}>Nuova password</h2>
          {!token && <Notice tone="bad">Link non valido: richiedi un nuovo link all'amministratore.</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label="Nuova password"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
          <Field label="Ripeti la password"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
          <Button variant="primary" size="lg" busy={busy} type="submit" disabled={!token}>Salva la password</Button>
        </form>
      </div>
    </div>
  );
}

export function ChangePassword() {
  const { me, toast, reloadMe } = useApp();
  const [f, setF] = useState({ current: "", pw: "", pw2: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const forced = me?.user?.must_change_password;
  const submit = async (e) => {
    e.preventDefault();
    if (f.pw !== f.pw2) { setError("Le due password non coincidono"); return; }
    setBusy(true); setError(null);
    try {
      await api.post("/auth/change-password", { current_password: f.current, new_password: f.pw });
      toast("Password cambiata", "ok");
      await reloadMe();
      navigate("/");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 440 }}>
      <PageHeader title="Cambia password" sub={forced ? "Al primo accesso devi sostituire la password temporanea." : null} />
      <form className="card stack" onSubmit={submit}>
        {error && <Notice tone="bad">{error}</Notice>}
        <Field label="Password attuale"><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>
        <Field label="Nuova password" hint="Almeno 10 caratteri, con maiuscole, minuscole e un numero">
          <Input type="password" autoComplete="new-password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} required />
        </Field>
        <Field label="Ripeti la nuova password"><Input type="password" autoComplete="new-password" value={f.pw2} onChange={(e) => setF({ ...f, pw2: e.target.value })} required /></Field>
        <Button variant="primary" busy={busy} type="submit">Cambia password</Button>
      </form>
    </div>
  );
}
