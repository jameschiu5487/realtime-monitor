import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm space-y-6 p-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Login</h1>
        <p className="text-muted-foreground">
          Enter your email and password to access your account
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
