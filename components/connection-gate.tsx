"use client";

import { mdiSwapHorizontal } from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ConnectionGateProps {
  onConfigure: () => void;
  /** Leaves Cross-Organization mode (no connections needed there). */
  onUseOrganization: () => void;
}

/** Cross-Organization mode without any stored connection yet. */
export function ConnectionGate({
  onConfigure,
  onUseOrganization,
}: ConnectionGateProps) {
  return (
    <div className="w-full pt-16">
      <Card style="outline" padding="lg" className="w-full text-center">
        <CardHeader className="items-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary-bg text-primary-fg">
            <Icon path={mdiSwapHorizontal} size={1} />
          </div>
          <CardTitle className="text-lg font-bold">
            Connect your environments for Cross-Organization transfers
          </CardTitle>
          <CardDescription className="text-text-subtle">
            Cross-Organization mode transfers content between any two
            SitecoreAI environments, including environments of other
            organizations. Each environment you want to use needs an{" "}
            <strong>automation client</strong> (Client ID and Client Secret)
            created in SitecoreAI Deploy, plus its environment host name. Add
            at least two connections — one source and one destination — to
            start a transfer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={onConfigure}>Manage connections</Button>
            <Button variant="outline" onClick={onUseOrganization}>
              Use Organization mode instead
            </Button>
          </div>
          <p className="max-w-2xl text-sm text-text-subtle">
            <a
              href="https://deploy.sitecorecloud.io/credentials/environment"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              Click here (ctrl + click) to create automation credentials
            </a>{" "}
            . In SitecoreAI Deploy, choose <strong>Credentials</strong> &gt;{" "}
            <strong>Environment</strong> &gt; <strong>Create credentials</strong>{" "}
            &gt; <strong>Automation</strong>. Find the environment host name
            under your project&apos;s authoring environment details.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
