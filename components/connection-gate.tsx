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
}

export function ConnectionGate({ onConfigure }: ConnectionGateProps) {
  return (
    <div className="w-full pt-16">
      <Card style="outline" padding="lg" className="w-full text-center">
        <CardHeader className="items-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary-bg text-primary-fg">
            <Icon path={mdiSwapHorizontal} size={1} />
          </div>
          <CardTitle className="text-lg font-bold">
            Connect your environments
          </CardTitle>
          <CardDescription className="text-text-subtle">
            This console transfers content between two SitecoreAI environments
            using the Content Transfer and Item Transfer APIs. Each environment
            you want to use needs an <strong>automation client</strong> (Client
            ID and Client Secret) created in SitecoreAI Deploy, plus its
            environment host name. Add at least two connections — one source
            and one destination — to start a transfer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          <Button onClick={onConfigure}>Manage connections</Button>
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
