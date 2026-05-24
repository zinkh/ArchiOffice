import * as React from 'react';

interface ArchiOfficeLogoProps {
  className?: string;
  size?: number;
}

export function ArchiOfficeLogo({ className, size = 32 }: ArchiOfficeLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 419.89 385.53"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path
        fill="#2a85ce"
        d="m66.72,260.99h83.26c15.35,0,25.07,16.47,17.65,29.91l-46.53,84.22c-3.55,6.42-10.31,10.41-17.65,10.41H20.19c-15.35,0-25.07-16.47-17.65-29.91l46.53-84.22c3.55-6.42,10.31-10.41,17.65-10.41Z"
      />
      <path
        fill="#2a85ce"
        d="m83.9,208.36L192.41,11.96c8.81-15.94,31.72-15.94,40.53,0l38.21,69.17c3.85,6.97,3.85,15.42,0,22.39l-70.29,127.23c-4.08,7.38-11.84,11.96-20.26,11.96h-76.43c-17.63,0-28.79-18.92-20.26-34.34Z"
      />
      <path
        fill="#2a85ce"
        d="m335.24,385.53c-13.2,0-29.22-9.45-35.61-21.01l-67.8-122.73c-4.66-8.43-4.66-18.66,0-27.09l32.04-57.99c10.66-19.29,38.38-19.29,49.04,0l103.45,187.25c10.31,18.67-3.19,41.56-24.52,41.56h-56.6Z"
      />
    </svg>
  );
}
