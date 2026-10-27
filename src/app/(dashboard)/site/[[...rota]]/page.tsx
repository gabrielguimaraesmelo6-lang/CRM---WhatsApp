import { EmConstrucao } from "@/components/modulos/em-construcao";

export const metadata = { title: "Site" };

export default function Site() {
  return (
    <EmConstrucao
      modulo="Site"
      etapa="Etapa 2"
      descricao="As telas do admin do site (estoque, vendidos, novo veículo, financeiro, documentos e as demais) estão sendo reconstruídas aqui dentro. O site público continua lendo do mesmo lugar, sem nenhuma mudança para o cliente. Até lá, o admin antigo segue funcionando normalmente."
    />
  );
}
