use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

fn get_slope(
    start_price: i64,
    start_time: i64,
    reserve_price: Option<i64>,
    end_time: i64,
) -> (i64, i64) {
    let num = (reserve_price.or(Some(0)).unwrap())
        .checked_sub(start_price)
        .unwrap();
    let den = end_time.checked_sub(start_time).unwrap();
    (num, den)
}

fn get_y_intercept(start_price: i64, start_time: i64, slope_num: i64, slope_den: i64) -> i64 {
    let slope_start_time = (((slope_num as i128).checked_mul(start_time as i128).unwrap()) as i64)
        .checked_div(slope_den)
        .unwrap();
    start_price.checked_sub(slope_start_time).unwrap()
}

fn get_current_price(current_time: i64, y_intercept: i64, slope_num: i64, slope_den: i64) -> u64 {
    let slope_cur_time = (((slope_num as i128)
        .checked_mul(current_time as i128)
        .unwrap()) as i64)
        .checked_div(slope_den)
        .unwrap();
    (slope_cur_time).checked_add(y_intercept).unwrap() as u64
}

#[program]
pub mod auction {
    use super::*;
    pub fn initialize(
        ctx: Context<Initialize>,
        mint_bump: u8,
        // auction values
        start_time: i64,
        end_time: i64,
        start_price: i64,
        reserve_price: Option<i64>,
    ) -> ProgramResult {
        let auction = &mut ctx.accounts.auction;
        // auction values
        auction.authority = ctx.accounts.authority.key();
        auction.start_time = start_time;
        auction.end_time = end_time;
        auction.start_price = start_price;
        auction.reserve_price = reserve_price;
        auction.is_ended = false;

        let (num, den) = get_slope(start_price, start_time, reserve_price, end_time);
        let y_intercept = get_y_intercept(start_price, start_time, num, den);

        auction.slope_num = num;
        auction.slope_den = den;
        auction.y_intercept = y_intercept;

        // minting 100 tokens to be owned by the account authority
        anchor_spl::token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.mint.to_account_info(),
                },
                &[&[&[], &[mint_bump]]],
            ),
            100,
        )?;

        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> ProgramResult {
        // NOTES FOR PROD
        // - This is not proper escrow software, and is probably currently unsafe

        let auction = &mut ctx.accounts.auction;
        let authority = &mut ctx.accounts.authority;
        let purchaser = &mut ctx.accounts.purchaser;
        let mint = &mut ctx.accounts.mint;

        if auction.is_ended {
            msg!("auction is ended");
            Ok(())
        } else {
            let clock = Clock::get()?;
            let current_timestamp = clock.unix_timestamp;

            // refuse transaction and end the auction if current time is past the end_time
            if current_timestamp > auction.end_time {
                auction.is_ended = true;
                msg!("auction is ended");
                Ok(())
            } else {
                // get the current price
                let current_price = get_current_price(
                    current_timestamp,
                    auction.y_intercept,
                    auction.slope_num,
                    auction.slope_den,
                );

                if purchaser.to_account_info().lamports() < current_price {
                    msg!("insufficent funds");
                    Ok(())
                } else {
                    // attempt to transfer all the funds
                    solana_program::program::invoke(
                        &solana_program::system_instruction::transfer(
                            purchaser.to_account_info().key,
                            authority.to_account_info().key,
                            current_price,
                        ),
                        &[
                            purchaser.to_account_info(),
                            authority.to_account_info(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                    )?;

                    // transfer of any authority of whatever is purchased occurs here
                    // in this case we are transferring Minting authority
                    // anchor_spl::token::set_authority(ctx, authority_type, new_authority)

                    let cpi_accounts = anchor_spl::token::SetAuthority {
                        account_or_mint: ctx.accounts.mint.to_account_info(),
                        current_authority: authority.to_account_info(),
                    };
                    let cpi_program = ctx.accounts.token_program.to_account_info();
                    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

                    anchor_spl::token::set_authority(
                        cpi_ctx,
                        spl_token::instruction::AuthorityType::MintTokens,
                        Some(*purchaser.to_account_info().key),
                    )?;

                    //end the auction
                    auction.is_ended = true;
                    Ok(())
                }
            }
        }
    }
}

#[derive(Accounts)]
#[instruction(mint_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 64 + 64)]
    pub auction: Account<'info, Auction>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,

    #[account(
        init,
        payer = authority,
        seeds = [],
        bump = mint_bump,
        mint::decimals = 0,
        mint::authority = mint,
    )]
    pub mint: Account<'info, Mint>,

    pub rent: Sysvar<'info, Rent>,
    pub token_program: Program<'info, Token>,
    //token things
    #[account(init_if_needed, payer = authority, associated_token::mint = mint, associated_token::authority = authority)]
    pub destination: Account<'info, TokenAccount>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub auction: Account<'info, Auction>,
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub purchaser: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Auction {
    pub authority: Pubkey,
    // timestamps (should be positive)
    pub start_time: i64,
    pub end_time: i64,
    // prices (should be positive)
    pub start_price: i64,
    pub reserve_price: Option<i64>,
    // math values (should only be positive)
    pub slope_num: i64,
    pub slope_den: i64,
    pub y_intercept: i64,
    // other
    pub is_ended: bool,
}
