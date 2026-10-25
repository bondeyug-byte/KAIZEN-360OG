// Privacy notice and terms of use: DRAFTS written from what the code actually does (audit 2026-10).
// They are not legal advice and have not been approved by VESIT or a lawyer. Items in [brackets] must be
// filled in by the college before public launch.
import { PageHeader, Card, Badge } from '../components/ui.jsx'

const DRAFT = (
  <p className="mb-5 rounded-lg border border-[#EBDDB9] bg-[#FDF8EC] px-3 py-2 text-[13.5px]">
    <Badge tone="warn">Draft</Badge> This text describes how Campus360 currently handles data. It has not been reviewed or approved by the college or by a lawyer, and it does not by itself make the service compliant with any law. Items in [brackets] are still to be decided by the college.
  </p>
)
const H = ({ children }) => <h2 className="mt-6 font-display text-[17px] font-semibold first:mt-0">{children}</h2>
const P = ({ children }) => <p className="mt-2 text-[14.5px] leading-relaxed">{children}</p>
const L = ({ items }) => <ul className="mt-2 list-disc space-y-1 pl-5 text-[14.5px] leading-relaxed">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>

export function Privacy() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back title="Privacy notice" subtitle="What Campus360 collects, why, who processes it and what you can do about it." />
      {DRAFT}
      <Card>
        <H>Who runs Campus360</H>
        <P>Campus360 is a student-built project for VES Institute of Technology, Chembur. The data fiduciary (the organisation responsible for your data) is [to be confirmed by the college]. Contact for privacy questions and requests: [to be designated by the college].</P>
        <H>What we collect and why</H>
        <L items={[
          'Your Google account email address and name, shared by Google when you choose “Continue with Google”, to sign you in and to recognise your role (student, teacher, HOD or parent). Campus360 asks Google for nothing else (no Gmail, Drive or contacts).',
          'Your name, and optionally your roll number and other profile fields you choose to add, so teachers can recognise you.',
          'Your class (division) and requests to join or change it, so you see your own timetable and class posts.',
          'Attendance and marks that your teachers record and publish, and attendance alerts your HOD publishes.',
          'Parent or guardian Google account emails that a student adds, which the class teacher must confirm before a parent can see anything.',
          'Posts, files and reminders that teachers send to classes.',
          'Your own planner data, study tasks and preferences, saved to your account so they appear on each device you sign in to.',
          'Canteen reviews and ride offers you choose to post. Your location is read only when you press the button to use it for a ride; it stays in your browser and is not sent to the Campus360 server.',
          'Messages you send to the voice or text assistant, together with the timetable, deadlines and other details the assistant needs to answer.',
        ]} />
        <H>Who can see what</H>
        <L items={[
          'Students see their own attendance and marks only, and posts for their own division.',
          'Teachers see the classes assigned to them. HODs see their branch. Class representatives can approve new students joining their class but never see contact details or the reason for a change of division.',
          'A parent sees only the student who added them, and only after the class teacher or HOD confirms the link.',
          'These checks run on the server for every request.',
        ]} />
        <H>Service providers that process data</H>
        <L items={[
          'Vercel (hosting and server functions).',
          'Neon (the database).',
          'Google (Firebase Authentication, for “Continue with Google”; it handles your Google sign-in and tells Campus360 your verified email and name).',
          'Google Gemini (only if the college enables the online assistant; it receives your assistant messages and the details needed to answer).',
          'Google Fonts, OpenStreetMap / CARTO map tiles and unpkg (your browser loads fonts, map images and a map library from them, which shares your IP address with them).',
        ]} />
        <P>Where these providers store data, and whether that meets the college’s requirements, has not been verified: [to be confirmed].</P>
        <H>Stored in your browser</H>
        <P>Campus360 keeps a copy of your data in your browser’s local storage so it works offline, plus a sign-in cookie that scripts on the page cannot read. Signing out removes the cookie. Clearing your browser data removes the local copy.</P>
        <H>How long we keep data</H>
        <P>There is no automatic deletion yet. Retention periods for attendance, marks and other academic records are [to be set by the college].</P>
        <H>Your choices and rights</H>
        <P>You can correct your profile at any time and remove a parent link you added. To ask for a copy of your data, a correction of a college record, or deletion, contact [the designated contact]. Campus360 does not yet have a self-service export or account deletion. Under India’s Digital Personal Data Protection Act, 2023 you may also complain to the Data Protection Board of India.</P>
        <H>Students under 18</H>
        <P>Some first-year students may be under 18. How the college obtains any consent needed from their parents or guardians, and which educational-purpose exemptions it relies on, is [to be decided by the college with legal advice].</P>
        <H>Changes</H>
        <P>Changes to this notice will be shown on this page with the date. Last updated: [date of approval].</P>
      </Card>
    </div>
  )
}

export function Terms() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back title="Terms of use" subtitle="The rules for using Campus360." />
      {DRAFT}
      <Card>
        <H>About the service</H>
        <P>Campus360 is a student project for VESIT, Chembur, provided as it is. Official notices, attendance and marks remain those kept by the college; if Campus360 differs from an official college record, the college record wins. [Confirm whether the college endorses Campus360.]</P>
        <H>Your account</H>
        <L items={[
          'Sign in only with your own Google account. Students, teachers and HODs use their college (…@ves.ac.in) account.',
          'Choose the division you are actually in. Joining or changing a division needs approval from a teacher or the HOD.',
          'Add a parent or guardian’s email only with their agreement.',
        ]} />
        <H>Acceptable use</H>
        <L items={[
          'Post only content you have the right to share. Notes and files must not break copyright.',
          'No harassment, impersonation, spam or attempts to access data that is not yours.',
          'Ride offers are arranged between students. Campus360 does not check drivers or vehicles; travel at your own judgement.',
          'Canteen reviews must be honest and about your own experience.',
        ]} />
        <H>Demo mode</H>
        <P>The demo accounts use fictional sample data stored only in your browser. Nothing you do in demo mode is a real college record.</P>
        <H>Availability and liability</H>
        <P>The service may be unavailable or change without notice. Train times are from the published timetable and are not live. [Liability terms to be written with legal advice.]</P>
        <H>Contact</H>
        <P>[To be designated by the college.]</P>
      </Card>
    </div>
  )
}
