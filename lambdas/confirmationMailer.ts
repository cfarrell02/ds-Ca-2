import { SNSHandler } from "aws-lambda";
import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";

if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
  throw new Error(
    "Please add the SES_EMAIL_TO, SES_EMAIL_FROM, and SES_REGION environment variables in an env.js file located in the root directory"
  );
}

const client = new SESClient({ region: SES_REGION });

export const handler: SNSHandler = async (event: any) => {
  for (const snsRecord of event.Records) {
    const snsMessage = snsRecord.Sns.Message;

    const messageData = JSON.parse(snsMessage);

    const s3e = messageData.Records[0].s3;
    const srcBucket = s3e.bucket.name;
    const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

    // Constructing a simple confirmation message
    const message = `We received your image. Its URL is s3://${srcBucket}/${srcKey}`;
    
    // Sending a confirmation email
    await sendConfirmationEmail(message);
  }
};

async function sendConfirmationEmail(message: string) {
  const parameters: SendEmailCommandInput = {
    Destination: {
      ToAddresses: [SES_EMAIL_TO],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: getHtmlContent(message),
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: `Image Received Confirmation`,
      },
    },
    Source: SES_EMAIL_FROM,
  };
  await client.send(new SendEmailCommand(parameters));
}

function getHtmlContent(message: string) {
  return `
    <html>
      <body>
        <p style="font-size:18px">${message}</p>
      </body>
    </html> 
  `;
}
