import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login",
  description: "Acesse o painel de controle do Facebook Auto Post.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
