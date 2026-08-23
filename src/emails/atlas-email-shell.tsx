import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

export type AtlasEmailShellProps = {
  locale: "ar" | "en";
  preview: string;
  title: string;
  requestNo?: string | null;
  stateLabel?: string | null;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
};

const FONT =
  "Montserrat, Arial, Helvetica, sans-serif";
const GREEN = "#519E53";
const INK = "#1C2229";
const MUTED = "#4D4D4D";
const LINE = "#DDDDDD";

export function AtlasEmailShell({
  locale,
  preview,
  title,
  requestNo,
  stateLabel,
  body,
  ctaUrl,
  ctaLabel,
}: AtlasEmailShellProps) {
  const dir = locale === "ar" ? "rtl" : "ltr";
  const align = locale === "ar" ? "right" : "left";

  return (
    <Html lang={locale} dir={dir}>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: "#F7F9F7",
          fontFamily: FONT,
          direction: dir,
        }}
      >
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: "#F7F9F7", width: "100%" }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 12px" }}>
                <Container
                  style={{
                    maxWidth: "560px",
                    width: "100%",
                    backgroundColor: "#FFFFFF",
                    border: `1px solid ${LINE}`,
                    borderRadius: "8px",
                    overflow: "hidden",
                  }}
                >
                  <Section
                    style={{
                      backgroundColor: GREEN,
                      padding: "16px 24px",
                    }}
                  >
                    <Text
                      style={{
                        margin: 0,
                        color: "#FFFFFF",
                        fontFamily: FONT,
                        fontSize: "16px",
                        fontWeight: 700,
                        textAlign: align,
                      }}
                    >
                      {locale === "ar" ? "أطلس للمساندة والخدمات" : "Atlas Support & Services"}
                    </Text>
                  </Section>

                  <Section style={{ padding: "24px" }}>
                    <Heading
                      as="h1"
                      style={{
                        margin: "0 0 12px",
                        color: INK,
                        fontFamily: FONT,
                        fontSize: "20px",
                        fontWeight: 700,
                        textAlign: align,
                      }}
                    >
                      {title}
                    </Heading>

                    {requestNo ? (
                      <Text
                        style={{
                          margin: "0 0 8px",
                          color: MUTED,
                          fontFamily:
                            "'IBM Plex Mono', Consolas, 'Courier New', monospace",
                          fontSize: "13px",
                          textAlign: align,
                          direction: "ltr",
                        }}
                      >
                        {requestNo}
                      </Text>
                    ) : null}

                    {stateLabel ? (
                      <Text
                        style={{
                          margin: "0 0 16px",
                          color: MUTED,
                          fontFamily: FONT,
                          fontSize: "13px",
                          textAlign: align,
                        }}
                      >
                        {stateLabel}
                      </Text>
                    ) : null}

                    <Text
                      style={{
                        margin: "0 0 24px",
                        color: INK,
                        fontFamily: FONT,
                        fontSize: "14px",
                        lineHeight: "22px",
                        textAlign: align,
                      }}
                    >
                      {body}
                    </Text>

                    <table
                      role="presentation"
                      cellPadding={0}
                      cellSpacing={0}
                      style={{ margin: "0 auto" }}
                    >
                      <tbody>
                        <tr>
                          <td
                            align="center"
                            style={{
                              backgroundColor: GREEN,
                              borderRadius: "8px",
                            }}
                          >
                            <Button
                              href={ctaUrl}
                              style={{
                                backgroundColor: GREEN,
                                borderRadius: "8px",
                                color: "#FFFFFF",
                                display: "inline-block",
                                fontFamily: FONT,
                                fontSize: "14px",
                                fontWeight: 600,
                                padding: "12px 20px",
                                textDecoration: "none",
                              }}
                            >
                              {ctaLabel}
                            </Button>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <Hr
                      style={{
                        borderColor: LINE,
                        marginTop: "28px",
                        marginBottom: "12px",
                      }}
                    />
                    <Text
                      style={{
                        margin: 0,
                        color: MUTED,
                        fontFamily: FONT,
                        fontSize: "11px",
                        textAlign: align,
                      }}
                    >
                      {locale === "ar"
                        ? "أطلس للمساندة والخدمات · معتمدة ISO/IEC 17020 و17065"
                        : "Atlas Support & Services · ISO/IEC 17020 & 17065"}
                    </Text>
                  </Section>
                </Container>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}
