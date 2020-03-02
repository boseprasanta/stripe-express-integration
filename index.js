const Stripe = require("stripe")
const fs = require("fs")
const request = require("request")
const currencyJson = require("./country-currency")

// stripe local key redeem-awe-defeat-fame @prasanta

module.exports = {
  getCurrentEnvironment() {
    if (process.env.ENVIRONMENT === "production") {
      return process.env.STRIPE_KEY_PROD
    }
    return process.env.STRIPE_KEY_TEST
  },

  createAccount(email) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.customers.create({ email })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },

  createVendor(email, country) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.accounts.create({
          email,
          country,
          type: "custom",
          requested_capabilities: ["card_payments", "transfers"]
        })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },

  deleteAccount(stripeId) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.accounts.del(stripeId)
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },

  createAccountToken(payload) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const token = stripe.tokens.create(payload)
        resolve(token)
      } catch (error) {
        reject(error)
      }
    })
  },

  addCard(id, token) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.customers.createSource(id, {
          source: token
        })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },

  setDefaultCard(stripeCustomerId, stripeCardId) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.customers.update(stripeCustomerId, {
          default_source: stripeCardId
        })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },

  fetchCard(id) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const result = await Promise.all([
          await stripe.customers.listSources(id),
          await stripe.customers.retrieve(id)
        ])
        const { data } = result[0]
        const { default_source } = result[1] // eslint-disable-line camelcase
        const stripeResponse = data.map(card => Object.assign(card, {
          isDefault: (card.id === default_source) // eslint-disable-line camelcase
        }))
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },
  deleteCard(id, cardId) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.customers.deleteSource(id, cardId)
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },

  addBankInfo(stripeId, routingNo, accountNo, accountHolderName = null, country) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const accountObj = {
          object: "bank_account",
          country,
          currency: currencyJson[country],
          account_number: accountNo,
          routing_number: routingNo
        }
        if (accountHolderName !== null) {
          accountObj.account_holder_name = accountHolderName
        }

        // eur doesn't have routing number support

        if (currencyJson[country] === "eur") delete accountObj.routing_number
        const stripeResponse = await stripe.accounts.update(stripeId, {
          external_account: accountObj
        })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },

  vendorKyc(stripeId, email, phone, address, dob, name, remoteAddress, docs, ssnLastFour = null, personalIdNumber = null) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const individual = {
          address,
          dob,
          email,
          phone,
          first_name: name.first,
          last_name: name.last
        }

        if (address.country === "US") {
          if (ssnLastFour !== null) individual.ssn_last_4 = ssnLastFour
          if (personalIdNumber !== null) individual.id_number = personalIdNumber
        }
        if (address.country === "IN") {
          individual.id_number = personalIdNumber
          individual.id_number_type = "PAN"
        }
        if (docs !== undefined) individual.verification = docs
        const kycDetailsObject = {
          business_type: "individual",
          business_profile: {
            url: "www.randomurl.com",
            mcc: "7299"
          },
          individual,
          tos_acceptance: {
            date: Math.floor(Date.now() / 1000),
            ip: remoteAddress // Assumes you're not using a proxy
          },
          settings: {
            payouts: {
              schedule: {
                interval: "manual"
              }
            }
          }
        }
        if (address.country === "IN") delete kycDetailsObject.settings
        const stripeResponse = await stripe.accounts.update(stripeId, kycDetailsObject)
        resolve(stripeResponse)
      } catch (error) {
        console.log("vendor KYC error", error)
        reject(error)
      }
    })
  },
 
  Payment(customer, vendor, amount, vendorAmount, currency = "usd", receiptEmail = null, description = null, statementDescriptor = null, capture = true) {
    return new Promise(async (resolve, reject) => {
      try {
        const amountInCents = Number(Number(amount * 100).toFixed(2))
        const vendorAmountInCents = Number(Number(vendorAmount * 100).toFixed(2))
        const stripe = Stripe(this.getCurrentEnvironment())
        const opts = {
          capture,
          customer,
          amount: amountInCents, // convert to cents from dollar
          currency,
          description,
          destination: {
            amount: vendorAmountInCents,
            account: vendor,
          }
        }
        if (receiptEmail !== null) opts.receipt_email = receiptEmail
        if (statementDescriptor !== null) opts.statement_descriptor = statementDescriptor
        const stripeResponse = await stripe.charges.create(opts)
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },
  MultiTransferPayment(customer, amount, transfers, transferGroup, currency = "usd", receiptEmail = null, description = null, statementDescriptor = null, capture = true) {
    return new Promise(async (resolve, reject) => {
      try {
        const amountInCents = Number(Number(amount * 100).toFixed(2))
        const stripe = Stripe(this.getCurrentEnvironment())
        const opts = {
          capture,
          customer,
          amount: amountInCents, // convert to cents from dollar
          currency,
          description,
          transfer_group: transferGroup
        }
        if (receiptEmail !== null) opts.receipt_email = receiptEmail
        if (statementDescriptor !== null) opts.statement_descriptor = statementDescriptor
        const stripeResponse = await stripe.charges.create(opts)

        const transferPromise = []
        transfers.forEach((elem) => {
          const elemAmount = Number(Number(elem.amount * 100).toFixed(2))
          transferPromise.push(
            stripe.transfers.create({
              amount: elemAmount,
              currency,
              destination: elem.stripeId,
              transfer_group: transferGroup
            })
          )
        })
        const transferResponses = await Promise.all(transferPromise)

        const trimmedTransferData = transfers.map((cur, index) => ({ ...cur, id: transferResponses[index].id }))
        resolve({
          charge: stripeResponse,
          transfers: trimmedTransferData
        })
      } catch (error) {
        reject(error)
      }
    })
  },
  payout(vendorId, vendorAmount, currency = "usd") {
    return new Promise(async (resolve, reject) => {
      try {
        const amount = Number(Number(vendorAmount * 100).toFixed(2))
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.payouts.create({
          amount,
          currency
        }, {
          stripe_account: vendorId,
        })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },
  checkBalance(vendorId) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.balance.retrieve({ stripe_account: vendorId })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },
  changeVendorPayoutSetting(vendorId) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.accounts.update(vendorId, {
          settings: {
            payouts: {
              schedule: {
                interval: "manual"
              }
            }
          }
        })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },
  chargeRefund(chargeId) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.refunds.create({
          charge: chargeId
        })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },
  transferRefund(transferId, amount) {
    return new Promise(async (resolve, reject) => {
      try {
        const amountInCents = Number(Number(amount * 100).toFixed(2))
        const stripe = Stripe(this.getCurrentEnvironment())
        const stripeResponse = stripe.transfers.createReversal(
          transferId,
          { amount: amountInCents }
        )
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },

  createStripeTransfer(amount, destination, transferGroup, currency = "usd") {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const amountInCents = Number(Number(amount * 100).toFixed(2))
        const stripeResponse = await stripe.transfers.create({
          amount: amountInCents,
          currency,
          destination,
          transfer_group: transferGroup
        })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },

  fileUpload(url, purpose, type) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = Stripe(this.getCurrentEnvironment())
        const fp = request(url)

        const stripeResponse = await stripe.files.create({
          purpose,
          file: {
            data: fp,
            type: "application/octet-stream",
          },
        })
        resolve({ ...stripeResponse, tfFileType: type })
      } catch (error) {
        reject(error)
      }
    })
  },
  retrieveVendorAccount(id) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = await Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.accounts.retrieve(id)
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  },

  createPerson(id, name, role) {
    return new Promise(async (resolve, reject) => {
      try {
        const stripe = await Stripe(this.getCurrentEnvironment())
        const stripeResponse = await stripe.accounts.createPerson(id,
          {
            first_name: name.first,
            last_name: name.last,
            relationship: role
          })
        resolve(stripeResponse)
      } catch (error) {
        reject(error)
      }
    })
  }

}
