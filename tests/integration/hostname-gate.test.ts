import { describe, it, expect } from 'vitest';

import {
  evaluateHostnameGate,
  type GateConfig,
} from '@/lib/middleware/hostnameGate';

const PROD_CONFIG: GateConfig = {
  adminHost: 'admin.example.com',
  customerHost: 'app.example.com',
  isProduction: true,
};

const DEV_CONFIG: GateConfig = {
  adminHost: null,
  customerHost: null,
  isProduction: false,
};

const PROD_NO_ENV: GateConfig = {
  adminHost: null,
  customerHost: null,
  isProduction: true,
};

describe('evaluateHostnameGate — produção configurada', () => {
  it('admin host + admin path → permitido (admin_host_admin_path)', () => {
    const r = evaluateHostnameGate('admin.example.com', '/admin/dashboard', PROD_CONFIG);
    expect(r).toEqual({ allowed: true, reason: 'admin_host_admin_path' });
  });

  it('admin host + path customer → 404 (admin_host_non_admin)', () => {
    const r = evaluateHostnameGate('admin.example.com', '/dashboard', PROD_CONFIG);
    expect(r).toEqual({ allowed: false, reason: 'admin_host_non_admin', status: 404 });
  });

  it('customer host + admin path → 404 (customer_host_admin_path)', () => {
    const r = evaluateHostnameGate('app.example.com', '/admin/login', PROD_CONFIG);
    expect(r).toEqual({ allowed: false, reason: 'customer_host_admin_path', status: 404 });
  });

  it('customer host + path customer → permitido (customer_host_non_admin)', () => {
    const r = evaluateHostnameGate('app.example.com', '/dashboard', PROD_CONFIG);
    expect(r).toEqual({ allowed: true, reason: 'customer_host_non_admin' });
  });

  it('host desconhecido + admin path → 404 (defesa em profundidade)', () => {
    const r = evaluateHostnameGate('preview-abc.vercel.app', '/admin/login', PROD_CONFIG);
    expect(r).toEqual({ allowed: false, reason: 'unknown_host_admin_path', status: 404 });
  });

  it('host desconhecido + path não-admin → permitido (compat com previews)', () => {
    const r = evaluateHostnameGate('preview-abc.vercel.app', '/dashboard', PROD_CONFIG);
    expect(r).toEqual({ allowed: true, reason: 'unknown_host_non_admin' });
  });

  it('admin host com porta é normalizado (split)', () => {
    const r = evaluateHostnameGate('admin.example.com:8080', '/admin', PROD_CONFIG);
    expect(r.allowed).toBe(true);
  });

  it('admin host case-insensitive', () => {
    const r = evaluateHostnameGate('Admin.Example.Com', '/admin/dashboard', PROD_CONFIG);
    expect(r.allowed).toBe(true);
  });
});

describe('evaluateHostnameGate — dev permissivo', () => {
  it('localhost passa para qualquer path (admin)', () => {
    const r = evaluateHostnameGate('localhost', '/admin/login', DEV_CONFIG);
    expect(r).toEqual({ allowed: true, reason: 'dev_permissive' });
  });

  it('localhost:3000 passa para customer path', () => {
    const r = evaluateHostnameGate('localhost:3000', '/dashboard', DEV_CONFIG);
    expect(r).toEqual({ allowed: true, reason: 'dev_permissive' });
  });

  it('127.0.0.1 passa para admin path', () => {
    const r = evaluateHostnameGate('127.0.0.1:3000', '/admin', DEV_CONFIG);
    expect(r).toEqual({ allowed: true, reason: 'dev_permissive' });
  });
});

describe('evaluateHostnameGate — produção mal-configurada', () => {
  it('prod sem env vars + admin path → 503 (hard-fail)', () => {
    const r = evaluateHostnameGate('app.example.com', '/admin/login', PROD_NO_ENV);
    expect(r).toEqual({ allowed: false, reason: 'prod_misconfigured', status: 503 });
  });

  it('prod sem env vars + path não-admin → permitido (compat)', () => {
    const r = evaluateHostnameGate('app.example.com', '/dashboard', PROD_NO_ENV);
    expect(r).toEqual({ allowed: true, reason: 'unknown_host_non_admin' });
  });
});

describe('evaluateHostnameGate — host vazio/null', () => {
  it('host null em prod configurado + admin path → 404', () => {
    const r = evaluateHostnameGate(null, '/admin/login', PROD_CONFIG);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('unknown_host_admin_path');
      expect(r.status).toBe(404);
    }
  });

  it('host vazio em dev → tratado como host desconhecido (não-dev)', () => {
    const r = evaluateHostnameGate('', '/admin/login', PROD_CONFIG);
    expect(r.allowed).toBe(false);
  });
});
