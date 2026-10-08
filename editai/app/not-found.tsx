import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="font-display text-7xl italic text-accent">404</p>
        <h1 className="mt-4 text-xl font-semibold">Essa página saiu no corte.</h1>
        <p className="mt-2 text-muted-foreground">O endereço não existe ou você não tem acesso a ele.</p>
        <Button asChild className="mt-8">
          <Link href="/">Voltar ao início</Link>
        </Button>
      </div>
    </main>
  );
}
