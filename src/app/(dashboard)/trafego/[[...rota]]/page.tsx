import { EmConstrucao } from "@/components/modulos/em-construcao";

export const metadata = { title: "Tráfego" };

export default function Trafego() {
  return (
    <EmConstrucao
      modulo="Tráfego"
      etapa="Etapa 1"
      descricao="As telas do painel de tráfego (campanhas, carros, vendedores, links UTM, alertas e conexões) estão sendo reconstruídas aqui dentro, com os dados no mesmo banco do CRM. Até lá, o painel antigo segue funcionando normalmente."
    />
  );
}
