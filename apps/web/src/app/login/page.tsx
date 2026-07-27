import { Brand } from '@/components/brand';
import { LoginClient } from '@/components/login-client';

export default function LoginPage() {
  return (
    <main className="login-page" id="main-content">
      <section className="login-story">
        <Brand />
        <div className="login-quote">
          <p className="eyebrow">Pay with anything. Settle exactly.</p>
          <h1>한 번의 서명으로 결제 운영을 시작하세요.</h1>
          <p>
            판매자 인증은 EIP-4361을 따릅니다. 로그인 서명 키와 PaymentIntent 위임 서명 키, 정산
            지갑의 권한은 서로 분리됩니다.
          </p>
        </div>
      </section>
      <section className="login-panel" aria-label="Merchant wallet sign-in">
        <LoginClient />
      </section>
    </main>
  );
}
