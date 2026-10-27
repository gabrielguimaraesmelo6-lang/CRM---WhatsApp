import "./trafego.css";

// Módulo Tráfego (sistema único, Etapa 1): telas que vieram do painel de
// tráfego. O invólucro .modulo-trafego prende os estilos do módulo.
export default function TrafegoLayout({ children }: { children: React.ReactNode }) {
  return <div className="modulo-trafego">{children}</div>;
}
