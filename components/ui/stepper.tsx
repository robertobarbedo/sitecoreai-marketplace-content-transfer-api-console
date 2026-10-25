"use client";

import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Blok stepper primitive (https://blok.sitecore.com/primitives/stepper),
 * adapted from the blok.sitecore.com/r/stepper.json registry source with an
 * extra "failed" status for pipeline steps that error out.
 */

export type StepperStatus = "completed" | "active" | "pending" | "failed";

export interface StepperStep {
  label: string;
  description?: string;
  status?: StepperStatus;
}

export interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: StepperStep[];
  currentStep?: number;
  size?: "default" | "sm" | "lg";
}

const stepIconVariants = cva(
  "flex items-center justify-center rounded-full font-medium transition-colors",
  {
    variants: {
      status: {
        completed: "bg-primary text-white",
        active:
          "border-2 border-primary bg-background text-primary animate-step-glow",
        pending: "border-2 border-border bg-background text-muted-foreground",
        failed: "border-2 border-danger bg-danger-bg text-danger-fg",
      },
      size: {
        default: "size-8 text-sm",
        sm: "size-6 text-xs",
        lg: "size-10 text-base",
      },
    },
    defaultVariants: {
      status: "pending",
      size: "default",
    },
  },
);

const stepLabelVariants = cva("font-medium transition-colors", {
  variants: {
    status: {
      completed: "text-foreground",
      active: "text-foreground",
      pending: "text-muted-foreground",
      failed: "text-danger-fg",
    },
  },
  defaultVariants: {
    status: "pending",
  },
});

const stepDescriptionVariants = cva("text-xs transition-colors", {
  variants: {
    status: {
      completed: "text-muted-foreground",
      active: "text-muted-foreground",
      pending: "text-muted-foreground/70",
      failed: "text-danger-fg/80",
    },
  },
  defaultVariants: {
    status: "pending",
  },
});

const connectorVariants = cva("transition-colors", {
  variants: {
    status: {
      completed: "bg-primary h-0.5",
      pending: "bg-border h-px",
    },
  },
  defaultVariants: {
    status: "pending",
  },
});

const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CrossIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

function StepperStepItem({
  step,
  index,
  isLast,
  size = "default",
}: {
  step: StepperStep;
  index: number;
  isLast: boolean;
  size?: "default" | "sm" | "lg";
}) {
  const status = step.status || "pending";

  return (
    <>
      <div className="flex shrink-0 items-start">
        <div className="flex shrink-0 flex-col items-center">
          <div className={cn(stepIconVariants({ status, size }))}>
            {status === "completed" ? (
              <CheckIcon className="size-4" />
            ) : status === "failed" ? (
              <CrossIcon className="size-4" />
            ) : (
              <span>{index + 1}</span>
            )}
          </div>
        </div>

        <div className="ml-3 flex min-w-0 flex-col">
          <div className={cn(stepLabelVariants({ status }))}>{step.label}</div>
          {step.description && (
            <div className={cn(stepDescriptionVariants({ status }))}>
              {step.description}
            </div>
          )}
        </div>
      </div>

      {/* Connector line - positioned between steps, aligned with circle center */}
      {!isLast && (
        <div className="flex flex-1 items-center">
          <div
            className={cn(
              connectorVariants({
                status: status === "completed" ? "completed" : "pending",
              }),
              "w-full",
            )}
          />
        </div>
      )}
    </>
  );
}

export function Stepper({
  steps,
  currentStep,
  size = "default",
  className,
  ...props
}: StepperProps) {
  // Determine step statuses based on currentStep if provided
  const stepsWithStatus = React.useMemo(() => {
    if (currentStep !== undefined) {
      return steps.map((step, index) => ({
        ...step,
        status:
          step.status ||
          ((index < currentStep
            ? "completed"
            : index === currentStep
              ? "active"
              : "pending") as StepperStatus),
      }));
    }
    return steps;
  }, [steps, currentStep]);

  return (
    <div
      className={cn(
        "flex w-full items-center gap-4 rounded-lg bg-muted/30 p-6",
        className,
      )}
      {...props}
    >
      {stepsWithStatus.map((step, index) => (
        <StepperStepItem
          key={index}
          step={step}
          index={index}
          isLast={index === stepsWithStatus.length - 1}
          size={size}
        />
      ))}
    </div>
  );
}
