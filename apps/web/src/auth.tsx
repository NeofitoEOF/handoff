import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, getAccessToken, setAccessToken } from "./api";

type LoginInput = {
  subdomain: string;
  email: string;
  password: string;
  otp?: string;
};

type AuthContextValue = {
  authenticated: boolean;
  login(input: LoginInput): Promise<void>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(() => !!getAccessToken());

  useEffect(() => {
    const update = () => setAuthenticated(!!getAccessToken());
    window.addEventListener("handoff-auth-change", update);
    return () => window.removeEventListener("handoff-auth-change", update);
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const tenant = await api<{ id: string }>(
      `/v1/public/tenants/resolve?subdomain=${encodeURIComponent(input.subdomain)}`,
      {},
      false,
    );

    const result = await api<{ accessToken: string }>(
      "/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: tenant.id,
          email: input.email,
          password: input.password,
          ...(input.otp ? { otp: input.otp } : {}),
        }),
      },
      false,
    );

    setAccessToken(result.accessToken);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/v1/auth/logout", { method: "POST" }, false);
    } finally {
      setAccessToken(null);
    }
  }, []);

  const value = useMemo(
    () => ({ authenticated, login, logout }),
    [authenticated, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
