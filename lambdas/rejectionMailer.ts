import { SQSHandler } from "aws-lambda";
import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";

if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
  throw new Error(
    "Please add the SES_EMAIL_TO, SES_EMAIL_FROM, and SES_REGION environment variables in an env.js file located in the root directory"
  );
}

const client = new SESClient({ region: SES_REGION });

export const handler: SQSHandler = async (event: any) => {

  console.log("Event ", event);

  for (const record of event.Records) {
    const recordBody = JSON.parse(JSON.parse(record.body).Message);
    console.log("Raw SNS message ", JSON.stringify(recordBody));
    if (recordBody.Records) {
      for (const messageRecord of recordBody.Records) {
        const key = messageRecord.s3.object.key;
        const bucket = messageRecord.s3.bucket.name;


        // Constructing a rejection message
        const message = `The image "${key}" could not be processed in bucket "${bucket}"`;

        // Sending a rejection email
        await sendRejectionEmail(message);

        console.log("Rejection email sent");

      }
    }
  }
      

};

async function sendRejectionEmail(message: string) {
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
        Data: `Image Rejected`,
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
