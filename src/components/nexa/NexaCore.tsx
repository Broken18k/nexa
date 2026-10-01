import { memo } from "react";
import type { TokenIdentity } from "@/nexa/types";
import nexaAgent from "@/assets/nexa-agent.png.asset.json";
import PixelFlowField from "@/components/ui/pixel-flow-field";

export const NexaCore = memo(function NexaCore({ active, tokens = [], owned = [] }: { active: boolean; tokens?: TokenIdentity[]; owned?: TokenIdentity[] }) {
  const status = owned.length > 0
    ? `${owned.length} owned token${owned.length === 1 ? "" : "s"}`
    : tokens.length > 0
      ? `${tokens.length} detected token${tokens.length === 1 ? "" : "s"}`
      : active ? "Connected to BNB Smart Chain" : "Connecting to BNB Smart Chain";

  return <figure className="nexa-core" aria-label={`NEXA agent. ${status}`}>
    <PixelFlowField
      className="nexa-flow-field"
      text="NEXA"
      shape="square"
      cellSize={5}
      gap={3}
      speed={0.55}
      pointerRadius={110}
      pointerStrength={0.65}
      colors={["var(--line)", "var(--signal)", "var(--foreground)"]}
    >
      <img className="nexa-agent" src={nexaAgent.url} alt="NEXA autonomous onchain agent" fetchPriority="high" />
    </PixelFlowField>
  </figure>;
});
