import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { title?: string }

function Svg({ title, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export function IconViewer3D(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </Svg>
  )
}

export function IconFolderKanban(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h16a2 2 0 002-2V8a2 2 0 00-2-2h-7.93a2 2 0 01-1.66-.9l-.82-1.2A2 2 0 007.93 3H4a2 2 0 00-2 2v13a2 2 0 002 2z" />
      <path d="M8 10h8M8 14h5" />
    </Svg>
  )
}

export function IconList(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Svg>
  )
}

export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </Svg>
  )
}

export function IconDrafting(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19l7-7 3 3-7 7h-3v-3z" />
      <path d="M18 13l-6-6a2.828 2.828 0 00-4 4l6 6M16 5l3 3" />
    </Svg>
  )
}

export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Svg>
  )
}

export function IconFileStack(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M12 18v-6M9 15h6" />
    </Svg>
  )
}

export function IconClipboardCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <path d="M9 5a2 2 0 012-2h2a2 2 0 012 2v0a2 2 0 01-2 2H11a2 2 0 01-2-2v0zM9 12l2 2 4-4" />
    </Svg>
  )
}

export function IconBox(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    </Svg>
  )
}

export function IconPackage(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    </Svg>
  )
}

export function IconInfo(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </Svg>
  )
}

export function IconCode(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
    </Svg>
  )
}

export function IconTable(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3h18v18H3zM3 9h18M9 21V9" />
    </Svg>
  )
}

export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </Svg>
  )
}

export function IconBarChart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20V10M18 20V4M6 20v-4" />
    </Svg>
  )
}

export function IconCompare(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
    </Svg>
  )
}

export function IconUserCog(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="7" r="4" />
      <path d="M3 21v-1a7 7 0 0114 0v1" />
      <circle cx="19" cy="19" r="2" />
      <path d="M19 17v4M17 19h4" />
    </Svg>
  )
}

export function IconUser(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
    </Svg>
  )
}

export function IconLogOut(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </Svg>
  )
}

export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </Svg>
  )
}

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <path d="M9 22V12h6v10" />
    </Svg>
  )
}

export function IconBriefcase(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
    </Svg>
  )
}
