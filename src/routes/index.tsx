import { createFileRoute } from "@tanstack/react-router";
import { StrategyLab } from "@/components/strategy-lab";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <StrategyLab />;
}
