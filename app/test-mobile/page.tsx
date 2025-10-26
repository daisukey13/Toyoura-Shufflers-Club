"use client";

export default function TestMobile() {
  return (
    <div className="p-4">
      <h1 className="text-2xl">モバイルテスト</h1>
      <p>このページが表示されれば基本的な動作は問題ありません</p>
      <p>
        ユーザーエージェント:{" "}
        {typeof window !== "undefined" ? window.navigator.userAgent : "SSR"}
      </p>
    </div>
  );
}
